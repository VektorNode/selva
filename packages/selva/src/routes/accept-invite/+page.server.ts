import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SYSTEM_CONTEXT, type Invite } from '@selvajs/platform';
import {
	getDataProvider,
	getInviteStore,
	getOrganizationProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';
import { findAuthUserByEmail } from '$lib/server/auth-lookup.server';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';
import { setSessionCookie } from '$lib/server/admin-auth.server';
import { hashToken } from '$lib/server/invites/token.server';
import { renderThrown } from '@selvajs/server/logging';

/**
 * Signup mode for an invite whose email has no account yet:
 *   - `password` — the provider owns credentials; show password + confirm fields.
 *   - `proxy`    — identity comes from upstream-proxy headers; the visit itself
 *                  is the proof of identity and no password is collected.
 */
function signupMode(auth: ReturnType<typeof getAuthProvider>): 'password' | 'proxy' {
	if (auth.passwordAuth) return 'password';
	return auth.proxyAuth && auth.createUser ? 'proxy' : 'password';
}

/**
 * Public page — the invite token is the capability. `SYSTEM_CONTEXT` is
 * passed to the invite store because there is no user session at this point;
 * the store treats an unknown/expired/consumed invite as a miss regardless.
 *
 * The raw URL token is HMAC-hashed before lookup — the store sees only the
 * digest. Mirrors the share-link flow.
 *
 * An invite addressed to an email that already has an account takes the `join`
 * mode instead of signing up: there is nothing to create, only a membership to
 * add. That branch demands a session, because the token proves the invite is
 * genuine — not that the visitor is the person it names. Honouring it
 * anonymously would let anyone holding a forwarded link join an org as someone
 * else.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const token = url.searchParams.get('token')?.trim();
	if (!token) {
		return { ok: false as const, reason: 'This invite link is missing a token.' };
	}

	const invite = await getInviteStore().getByTokenHash(SYSTEM_CONTEXT, hashToken(token));
	if (!invite) {
		return { ok: false as const, reason: 'This invite link is invalid or has expired.' };
	}

	const org = await getOrganizationProvider().getOrg(SYSTEM_CONTEXT, invite.orgId);
	const auth = getAuthProvider();
	const existing = await findAuthUserByEmail(auth, invite.email).catch(() => null);
	const mode: 'password' | 'proxy' | 'join' = existing ? 'join' : signupMode(auth);

	return {
		ok: true as const,
		email: invite.email,
		orgName: org?.name ?? 'the organization',
		token,
		mode,
		// `join` only: whether the visitor is already signed in as the invitee,
		// which decides between the confirm button and a sign-in prompt.
		signedInAsInvitee: mode === 'join' && !!locals.user && locals.user.id === existing!.id
	};
};

export const actions = {
	default: async ({ request, cookies, locals }) => {
		const data = await request.formData();
		const token = (data.get('token') as string | null)?.trim() ?? '';
		const password = data.get('password') as string | null;
		const confirm = data.get('confirm') as string | null;
		const displayName = (data.get('displayName') as string | null)?.trim() || undefined;

		if (!token) {
			return fail(400, { error: 'Missing invite token.' });
		}

		let invite: Invite | null;
		try {
			invite = await getInviteStore().getByTokenHash(SYSTEM_CONTEXT, hashToken(token));
		} catch {
			return fail(500, { error: 'Could not validate the invite. Please try again.' });
		}
		if (!invite) {
			return fail(410, { error: 'This invite link is invalid or has expired.' });
		}

		const auth = getAuthProvider();
		const existing = await findAuthUserByEmail(auth, invite.email).catch(() => null);
		const mode: 'password' | 'proxy' | 'join' = existing ? 'join' : signupMode(auth);

		if (mode === 'password') {
			if (!password || password.length < 8) {
				return fail(400, { error: 'Password must be at least 8 characters.' });
			}
			if (password !== confirm) {
				return fail(400, { error: 'Passwords do not match.' });
			}
		}

		// The token says the invite is real; it does not say who is holding it.
		// For a brand-new account that gap closes itself — accepting is what
		// creates the identity. An existing account has to prove it is theirs.
		if (mode === 'join' && locals.user?.id !== existing!.id) {
			return fail(401, {
				error: `${invite.email} already has an account. Sign in as ${invite.email}, then open this link again to join.`
			});
		}

		let user;
		if (mode === 'join') {
			user = existing!;
		} else {
			try {
				if (mode === 'password' && auth.passwordAuth) {
					user = await auth.passwordAuth.createUserWithPassword(invite.email, password!);
				} else if (mode === 'proxy' && auth.createUser) {
					// Forward-auth allowlist entry — the operator is currently behind the
					// trusted proxy, so the next request will identify them via headers
					// and mint a session. No password to collect, no token to set here.
					user = await auth.createUser(invite.email);
				} else {
					return fail(501, { error: 'This provider does not support invite-based signup.' });
				}
			} catch (err) {
				// The account is created before the invite is consumed on purpose: a
				// failed signup must leave the invite usable. A re-submit is caught by
				// the `!invite` guard above, which already returns 410.
				const msg = err instanceof Error ? err.message : 'Could not create your account.';
				return fail(400, { error: msg });
			}
		}

		try {
			// Authority the inviting admin chose at mint time. The mint route already
			// verified they held `instance_admin` — re-checking here is impossible,
			// as the only party present now is the invitee.
			if (invite.platformPermissions?.length) {
				// `set` keys on the data-layer row, which is normally seeded by
				// `ensureUser` on the first authed request — one the invitee has not
				// made yet. Without this the grant returns `not_found` and vanishes.
				await getDataProvider().ensureUser(SYSTEM_CONTEXT, user.id);
				const granted = await setUserPlatformPermissions(
					SYSTEM_CONTEXT,
					user.id,
					invite.platformPermissions
				);
				if (granted !== 'ok') {
					throw new Error(`Platform permission grant failed: ${granted}`);
				}
			}

			const orgs = getOrganizationProvider();
			// `addOrgMember` upserts, so accepting a second invite to an org the
			// user is already in would overwrite their role — a `member` invite
			// would demote an owner. Consume the invite and leave them as they are.
			const alreadyMember = await orgs.getOrgMember(SYSTEM_CONTEXT, invite.orgId, user.id);
			if (!alreadyMember) {
				const joinedAt = new Date().toISOString();
				await orgs.addOrgMember(SYSTEM_CONTEXT, {
					orgId: invite.orgId,
					userId: user.id,
					role: invite.orgRole,
					permissions: invite.orgPermissions,
					joinedAt,
					updatedAt: joinedAt,
					updatedBy: invite.invitedBy,
					deletedAt: null
				});
			}
			await getInviteStore().markAccepted(SYSTEM_CONTEXT, invite.id, user.id);
		} catch (err) {
			locals.log.error('Post-signup wiring failed', {
				component: 'accept-invite',
				err: renderThrown(err)
			});
			// The account is intact either way; surface a softer failure rather
			// than a blank 500. An admin can add the membership by hand.
			return fail(500, {
				error:
					mode === 'join'
						? 'We could not add you to the organization. Please contact your admin.'
						: 'Your account was created, but we could not finish joining the organization. Please contact your admin.'
			});
		}

		// Best-effort display name update — never blocks the signup. Skipped when
		// joining: that profile is the user's own, not this invite's to rename.
		if (displayName && mode !== 'join') {
			try {
				// `updateProfile` patches an existing row and 404s on a missing one.
				// The data-layer row is normally seeded by `ensureUser` on the first
				// authed request — one the invitee has not made yet — so without this
				// the name the invitee typed was silently dropped.
				await getDataProvider().ensureUser(SYSTEM_CONTEXT, user.id);
				// User has just been created and isn't yet logged in — no ctx available.
				// SYSTEM_CONTEXT is the right shape for an internal post-signup write.
				const result = await getUserProfileStore().updateProfile(SYSTEM_CONTEXT, user.id, {
					displayName
				});
				// Returns a status rather than throwing, so an ignored result loses the
				// name with no trace.
				if (result !== 'ok') {
					locals.log.warn('Could not set display name at signup', {
						component: 'accept-invite',
						userId: user.id,
						result
					});
				}
			} catch (err) {
				// Non-fatal: the account and membership are already in place.
				locals.log.warn('Could not set display name at signup', {
					component: 'accept-invite',
					userId: user.id,
					err: renderThrown(err)
				});
			}
		}

		if (mode === 'password' && auth.passwordAuth) {
			// Sign in to mint a session token — matches Supabase's shape.
			const loginResult = await auth.passwordAuth.verifyLogin(invite.email, password!);
			if (loginResult.kind !== 'success') {
				return fail(500, {
					error: 'Your account was created but login failed. Please sign in manually.'
				});
			}
			setSessionCookie(cookies, loginResult.sessionToken);
		}
		// Proxy mode: nothing to mint here. The very next request hits
		// hooks.server.ts → proxyAuth.identifyFromHeaders → matches the
		// allowlist row we just created → session attached transparently.
		//
		// Join mode: the session already in play is the one that proved identity,
		// and an existing user lands in the app rather than the admin shell.
		redirect(303, mode === 'join' ? '/library' : '/admin');
	}
} satisfies Actions;
