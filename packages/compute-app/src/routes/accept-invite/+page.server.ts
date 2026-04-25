import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SYSTEM_CONTEXT, type Invite } from '@selva/platform';
import {
	getInviteStore,
	getOrganizationProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';
import { setSessionCookie } from '$lib/server/admin-auth.server';

/**
 * Public page — the invite token is the capability. `SYSTEM_CONTEXT` is
 * passed to the invite store because there is no user session at this point;
 * the store treats an unknown/expired/consumed token as a miss regardless.
 */
export const load: PageServerLoad = async ({ url }) => {
	const token = url.searchParams.get('token')?.trim();
	if (!token) {
		return { ok: false as const, reason: 'This invite link is missing a token.' };
	}

	const invite = await getInviteStore().getByToken(SYSTEM_CONTEXT, token);
	if (!invite) {
		return { ok: false as const, reason: 'This invite link is invalid or has expired.' };
	}

	const org = await getOrganizationProvider().getOrg(SYSTEM_CONTEXT, invite.orgId);
	return {
		ok: true as const,
		email: invite.email,
		orgName: org?.name ?? 'the organization',
		token
	};
};

export const actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const token = (data.get('token') as string | null)?.trim() ?? '';
		const password = data.get('password') as string | null;
		const confirm = data.get('confirm') as string | null;
		const displayName = (data.get('displayName') as string | null)?.trim() || undefined;

		if (!token) {
			return fail(400, { error: 'Missing invite token.' });
		}
		if (!password || password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters.' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		let invite: Invite | null;
		try {
			invite = await getInviteStore().getByToken(SYSTEM_CONTEXT, token);
		} catch {
			return fail(500, { error: 'Could not validate the invite. Please try again.' });
		}
		if (!invite) {
			return fail(410, { error: 'This invite link is invalid or has expired.' });
		}

		const auth = getAuthProvider();
		if (!auth.passwordAuth) {
			return fail(501, { error: 'This provider does not support password signup.' });
		}

		let user;
		try {
			// Invites grant org-scope perms only; new users start with no
			// platform permissions (the empty default in IPlatformPermissionStore).
			user = await auth.passwordAuth.createUserWithPassword(invite.email, password);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Could not create your account.';
			return fail(400, { error: msg });
		}

		try {
			const joinedAt = new Date().toISOString();
			await getOrganizationProvider().addOrgMember(SYSTEM_CONTEXT, {
				orgId: invite.orgId,
				userId: user.id,
				role: invite.orgRole,
				permissions: invite.orgPermissions,
				joinedAt,
				updatedAt: joinedAt,
				updatedBy: invite.invitedBy,
				deletedAt: null
			});
			await getInviteStore().markAccepted(SYSTEM_CONTEXT, invite.id, user.id);
		} catch (err) {
			console.error('[accept-invite] post-signup wiring failed', err);
			// The user account exists; surface a softer failure rather than a
			// blank 500. They can still log in — an admin can add membership.
			return fail(500, {
				error: 'Your account was created, but we could not finish joining the organization. Please contact your admin.'
			});
		}

		// Best-effort display name update — never blocks the signup
		if (displayName) {
			try {
				// User has just been created and isn't yet logged in — no ctx available.
				// SYSTEM_CONTEXT is the right shape for an internal post-signup write.
				await getUserProfileStore().updateProfile(SYSTEM_CONTEXT, user.id, { displayName });
			} catch {
				// Non-fatal
			}
		}

		// §1a: sign in to mint a session token — matches Supabase's shape.
		const loginResult = await auth.passwordAuth.verifyLogin(invite.email, password);
		if (loginResult.kind !== 'success') {
			return fail(500, {
				error: 'Your account was created but login failed. Please sign in manually.'
			});
		}
		setSessionCookie(cookies, loginResult.sessionToken);
		redirect(303, '/admin');
	}
} satisfies Actions;
