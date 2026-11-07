/**
 * Accept-invite flow — the invite token is the capability, and accepting it
 * creates an account plus org membership in one unauthenticated request.
 *
 * The store-level suites already cover expiry and `markAccepted` idempotence.
 * What's only reachable here is the route's own sequencing: the raw URL token
 * being hashed before lookup, the account existing before the invite is
 * consumed, and the double-submit race that ordering allows.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedOrg,
	seedOrgMember,
	seedUser,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { POST as mintInvite } from '../../api/v1/orgs/[orgId]/invites/+server.js';
import { hashToken } from '#lib/server/invites/token.server.js';
import { load, actions } from '../+page.server.js';
import { findAuthUserByEmail } from '@selvajs/server/providers';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

const INVITEE = 'newhire@acme.test';
const PASSWORD = 'correct-horse-battery';

/** Mint a real invite through the API and hand back its raw URL token. */
async function mintFor(tp: TestProviders, email = INVITEE): Promise<string> {
	const { alice, acme } = await seedAcme(tp);
	const aliceLocals = await actAs(tp, alice.id);
	const res = await call(mintInvite, {
		locals: aliceLocals,
		params: { orgId: acme.id },
		body: { email, orgRole: 'member', permissions: [] }
	});
	expect(res.status).toBe(201);
	const { acceptUrl } = res.json as { acceptUrl: string };
	return new URL(acceptUrl).searchParams.get('token')!;
}

/**
 * Invoke the form action. `redirect()` throws, so a 303 surfaces as a caught
 * Location rather than a return value — callers assert on `redirected`.
 */
async function submit(
	token: string,
	fields: Record<string, string> = {},
	locals: Record<string, unknown> = {}
): Promise<{ status?: number; error?: string; redirected?: string; cookies: Map<string, string> }> {
	const form = new FormData();
	form.set('token', token);
	for (const [k, v] of Object.entries(fields)) form.set(k, v);

	const cookies = new Map<string, string>();
	const event = {
		request: new Request('http://test.local/accept-invite', { method: 'POST', body: form }),
		cookies: {
			get: (n: string) => cookies.get(n),
			set: (n: string, v: string) => cookies.set(n, v),
			delete: (n: string) => cookies.delete(n),
			getAll: () => Array.from(cookies.entries()).map(([name, value]) => ({ name, value }))
		},
		locals: { log: { error: () => {}, warn: () => {}, info: () => {} }, ...locals }
	};

	try {
		const result = (await actions.default(event as never)) as
			{ status?: number; data?: { error?: string } } | undefined;
		return { status: result?.status, error: result?.data?.error, cookies };
	} catch (err) {
		const e = err as { status?: number; location?: string };
		if (e.location) return { redirected: e.location, cookies };
		throw err;
	}
}

describe('accept-invite load', () => {
	it('resolves a freshly minted invite by hashing the raw URL token', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const result = (await load({
			url: new URL(`http://test.local/accept-invite?token=${token}`)
		} as never)) as { ok: boolean; email?: string; orgName?: string };

		expect(result.ok).toBe(true);
		expect(result.email).toBe(INVITEE);
		expect(result.orgName).toBe('Acme');
	});

	it('reports a missing token without touching the store', async () => {
		tp = await freshProviders();
		const result = (await load({ url: new URL('http://test.local/accept-invite') } as never)) as {
			ok: boolean;
			reason?: string;
		};
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/missing a token/i);
	});

	it('rejects a token that never existed', async () => {
		tp = await freshProviders();
		await seedAcme(tp);
		const result = (await load({
			url: new URL('http://test.local/accept-invite?token=invite_bogus')
		} as never)) as { ok: boolean; reason?: string };
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/invalid or has expired/i);
	});

	it('rejects the raw hash — only the raw token resolves', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		// Passing the stored digest must not authenticate: load hashes whatever
		// it receives, so the digest hashes again and misses.
		const result = (await load({
			url: new URL(`http://test.local/accept-invite?token=${hashToken(token)}`)
		} as never)) as { ok: boolean };
		expect(result.ok).toBe(false);
	});
});

describe('accept-invite submit', () => {
	it('creates the account, joins the org, and consumes the invite', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const res = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(res.redirected).toBe('/admin');

		// Account exists and the password actually works.
		const created = await tp.authUsers.findByEmail(INVITEE);
		expect(created).not.toBeNull();
		const login = await tp.config.auth.passwordAuth!.verifyLogin(INVITEE, PASSWORD);
		expect(login.kind).toBe('success');

		// Membership was written with the invite's role.
		const membership = await tp.config.data.orgs.findUserMembership(SYSTEM_CONTEXT, created!.id);
		expect(membership?.member.role).toBe('member');

		// Invite is consumed — the same token no longer resolves.
		expect(
			await tp.config.data.invites.getByTokenHash(SYSTEM_CONTEXT, hashToken(token))
		).toBeNull();
	});

	it('sets a session cookie so the invitee lands signed in', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const res = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(res.redirected).toBe('/admin');
		expect(res.cookies.size).toBeGreaterThan(0);
	});

	it('rejects a short password before creating anything', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const res = await submit(token, { password: 'short', confirm: 'short' });
		expect(res.status).toBe(400);
		expect(res.error).toMatch(/at least 8 characters/i);

		// Nothing was created, and the invite is still usable.
		expect(await tp.authUsers.findByEmail(INVITEE)).toBeNull();
		expect(
			await tp.config.data.invites.getByTokenHash(SYSTEM_CONTEXT, hashToken(token))
		).not.toBeNull();
	});

	it('rejects mismatched confirmation', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const res = await submit(token, { password: PASSWORD, confirm: PASSWORD + '-typo' });
		expect(res.status).toBe(400);
		expect(res.error).toMatch(/do not match/i);
		expect(await tp.authUsers.findByEmail(INVITEE)).toBeNull();
	});

	it('rejects a missing token', async () => {
		tp = await freshProviders();
		await seedAcme(tp);

		const res = await submit('', { password: PASSWORD, confirm: PASSWORD });
		expect(res.status).toBe(400);
		expect(res.error).toMatch(/missing invite token/i);
	});

	it('hands the invite back when joining the org fails, so the invitee can retry', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);
		vi.spyOn(tp.config.data.orgs, 'addOrgMember').mockRejectedValueOnce(new Error('db blip'));

		const first = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(first.status).toBe(500);
		expect(first.error).toMatch(/open this link again/i);
		expect(
			await tp.config.data.invites.getByTokenHash(SYSTEM_CONTEXT, hashToken(token))
		).not.toBeNull();

		// The account exists now, so the retry is a join, made signed in.
		const created = await tp.authUsers.findByEmail(INVITEE);
		const retry = await submit(token, {}, { user: (await actAs(tp, created!.id)).user });
		expect(retry.redirected).toBe('/library');
		const membership = await tp.config.data.orgs.findUserMembership(SYSTEM_CONTEXT, created!.id);
		expect(membership?.member.role).toBe('member');
	});

	it('rejects an already-consumed invite with 410', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const first = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(first.redirected).toBe('/admin');

		// Sequential re-submit: the invite is gone, so the guard before signup
		// catches it — no duplicate account attempt.
		const second = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(second.status).toBe(410);
		expect(second.error).toMatch(/invalid or has expired/i);
	});

	/**
	 * Two simultaneous submits can both read the invite before either claims it.
	 * The claim is atomic, so exactly one signup completes. The loser may still
	 * have created a duplicate account first: the local user store checks email
	 * uniqueness with a read-modify-write. Supabase enforces it in the database.
	 */
	it('concurrent double-submit: exactly one signup succeeds', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const results = await Promise.all([
			submit(token, { password: PASSWORD, confirm: PASSWORD }),
			submit(token, { password: PASSWORD, confirm: PASSWORD })
		]);

		expect(results.filter((r) => r.redirected === '/admin')).toHaveLength(1);
		expect(
			await tp.config.data.invites.getByTokenHash(SYSTEM_CONTEXT, hashToken(token))
		).toBeNull();

		// Where the loser lost decides its status: 410 when the invite was already
		// claimed, 400 when the user store rejected the duplicate email. Either way
		// it carries a message for the visitor.
		const [loser] = results.filter((r) => !r.redirected);
		expect([400, 410]).toContain(loser.status);
		expect(loser.error).toBeTruthy();
	});
});

/**
 * Under forward-auth (Entra) there is no password to set: the invite's job is
 * to create the allowlist row, and the IdP proves identity on the next request.
 * The route picks this branch purely from the provider's shape — `proxyAuth`
 * and `createUser` present, `passwordAuth` absent.
 *
 * This is the only automated coverage of that branch, and header-auth is the
 * one provider in production use.
 */
describe('accept-invite under forward-auth', () => {
	/** Swap in a provider shaped like HeaderAuthProvider for one test. */
	function useProxyAuth(providers: TestProviders) {
		const config = providers.config as unknown as { auth: Record<string, unknown> };
		const createUser = vi.fn(async (email: string) => {
			const user = await providers.authUsers.createUser(email, null);
			return { id: user.id, email: user.email, displayName: null };
		});
		config.auth = {
			name: 'header-auth',
			createUser,
			proxyAuth: { hasNoIdentityHeaders: () => false },
			verifyToken: async () => null,
			getUser: async (id: string) => {
				const user = await providers.authUsers.findById(id);
				return user && { id: user.id, email: user.email, disabled: user.disabled };
			}
		};
		return createUser;
	}

	it('renders in proxy mode, so the page asks for no password', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);
		useProxyAuth(tp);

		const data = (await load({
			url: new URL(`http://test.local/accept-invite?token=${token}`)
		} as never)) as { mode: string; email: string };

		expect(data.mode).toBe('proxy');
		expect(data.email).toBe(INVITEE);
	});

	it('allowlists the invitee and consumes the invite without a password', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);
		const createUser = useProxyAuth(tp);

		const result = await submit(token);

		expect(result.redirected).toBe('/admin');
		expect(createUser).toHaveBeenCalledWith(INVITEE);
		expect(
			await tp.config.data.invites.getByTokenHash(SYSTEM_CONTEXT, hashToken(token))
		).toBeNull();
	});

	it('joins the org so the allowlisted user can actually see something', async () => {
		// The allowlist row grants identity, not access. Without the membership
		// the invitee authenticates through Entra and lands on an empty account.
		tp = await freshProviders();
		const token = await mintFor(tp);
		useProxyAuth(tp);

		expect((await submit(token)).redirected).toBe('/admin');

		const invited = await tp.authUsers.findByEmail(INVITEE);
		const orgs = await tp.config.data.orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
		const members = await tp.config.data.orgs.listOrgMembers(SYSTEM_CONTEXT, orgs.items[0].id);
		expect(members.items.some((m) => m.userId === invited!.id)).toBe(true);
	});

	it('sets no session cookie — the proxy authenticates the next request', async () => {
		// The password branch signs the invitee in directly. Under forward-auth
		// there is no Selva-owned credential to build a session from.
		tp = await freshProviders();
		const token = await mintFor(tp);
		useProxyAuth(tp);

		const result = await submit(token);

		expect(result.redirected).toBe('/admin');
		expect(result.cookies.size).toBe(0);
	});
});

/**
 * Accepting an invite that carries instance-wide permissions is the only way to
 * create a second instance admin once an admin can no longer set someone's
 * password. If the grant silently no-ops here, a deployment is stuck with the
 * one admin it bootstrapped with.
 */
describe('accept-invite grants platform permissions', () => {
	/** Mint an invite carrying `permissions`, as an instance admin would. */
	async function mintCarrying(tp: TestProviders, permissions: string[]): Promise<string> {
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);
		const res = await call(mintInvite, {
			locals,
			params: { orgId: acme.id },
			body: { email: INVITEE, orgRole: 'member', permissions }
		});
		expect(res.status).toBe(201);
		const { acceptUrl } = res.json as { acceptUrl: string };
		return new URL(acceptUrl).searchParams.get('token')!;
	}

	it('adds to the permissions an existing user already holds', async () => {
		tp = await freshProviders();
		const token = await mintCarrying(tp, ['manage_instance_users']);
		const user = await seedUser(tp, INVITEE);
		await grantPlatformPermissions(tp, user.id, ['manage_updates', 'manage_compute']);

		await submit(token, {}, { user: (await actAs(tp, user.id)).user });

		const perms = await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, user.id);
		expect([...perms].sort()).toEqual([
			'manage_compute',
			'manage_instance_users',
			'manage_updates'
		]);
	});

	it('promotes the invitee to instance_admin on accept', async () => {
		tp = await freshProviders();
		const token = await mintCarrying(tp, ['instance_admin']);

		const result = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(result.redirected).toBe('/admin');

		const invited = await tp.authUsers.findByEmail(INVITEE);
		const perms = await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, invited!.id);
		expect(perms).toContain('instance_admin');
	});

	it('grants nothing when the invite is revoked while the account is being created', async () => {
		tp = await freshProviders();
		const token = await mintCarrying(tp, ['instance_admin']);
		const invites = tp.config.data.invites;
		const invite = await invites.getByTokenHash(SYSTEM_CONTEXT, hashToken(token));
		const passwordAuth = tp.config.auth.passwordAuth!;
		const createUser = passwordAuth.createUserWithPassword.bind(passwordAuth);
		vi.spyOn(passwordAuth, 'createUserWithPassword').mockImplementation(async (email, pw) => {
			const user = await createUser(email, pw);
			await invites.revoke(SYSTEM_CONTEXT, invite!.id);
			return user;
		});

		const result = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(result.status).toBe(410);
		expect(result.error).toMatch(/revoked or already used/i);

		const invited = await tp.authUsers.findByEmail(INVITEE);
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, invited!.id)).toEqual([]);
		expect(await tp.config.data.orgs.findUserMembership(SYSTEM_CONTEXT, invited!.id)).toBeNull();
	});

	it('leaves an ordinary invitee with no platform permissions', async () => {
		tp = await freshProviders();
		const token = await mintCarrying(tp, ['manage_definitions']);

		await submit(token, { password: PASSWORD, confirm: PASSWORD });

		const invited = await tp.authUsers.findByEmail(INVITEE);
		const perms = await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, invited!.id);
		expect(perms).toEqual([]);
	});
});

/**
 * Inviting an email that already has an account. Signing up is not an option —
 * the provider would reject the duplicate — so the flow adds a membership to
 * the account that exists. Multi-tenant is where this stops being hypothetical:
 * one person, one login, several orgs.
 */
describe('accept-invite for an existing account', () => {
	/**
	 * Invite `email` to a second org, so accepting is a join and not a signup.
	 * The inviter is Globex-only: `findUserMembership` returns the first
	 * membership by insertion order, so an Acme member would act in Acme and
	 * `requireActingOrg` would reject the mint.
	 */
	async function mintForExisting(
		tp: TestProviders,
		email: string
	): Promise<{ token: string; orgId: string }> {
		await seedAcme(tp);
		const dana = await seedUser(tp, 'dana@globex.test');
		const other = await seedOrg(tp, { name: 'Globex', slug: 'globex', ownerId: dana.id });
		await seedOrgMember(tp, { orgId: other.id, userId: dana.id, role: 'owner' });
		const locals = await actAs(tp, dana.id);
		const res = await call(mintInvite, {
			locals,
			params: { orgId: other.id },
			body: { email, orgRole: 'member', permissions: [] }
		});
		expect(res.status).toBe(201);
		const { acceptUrl } = res.json as { acceptUrl: string };
		return { token: new URL(acceptUrl).searchParams.get('token')!, orgId: other.id };
	}

	it('reports join mode rather than asking an existing user for a password', async () => {
		tp = await freshProviders();
		const existing = await seedUser(tp, 'carol@acme.test');
		const { token } = await mintForExisting(tp, 'carol@acme.test');

		const result = (await load({
			url: new URL(`http://test.local/accept-invite?token=${token}`),
			locals: { user: { id: existing.id, email: 'carol@acme.test' } }
		} as never)) as { ok: boolean; mode?: string; signedInAsInvitee?: boolean };

		expect(result.ok).toBe(true);
		expect(result.mode).toBe('join');
		expect(result.signedInAsInvitee).toBe(true);
	});

	it('adds the membership without creating a second account', async () => {
		tp = await freshProviders();
		const existing = await seedUser(tp, 'carol@acme.test');
		const { token, orgId } = await mintForExisting(tp, 'carol@acme.test');

		const result = await submit(token, {}, { user: { id: existing.id, email: 'carol@acme.test' } });
		expect(result.redirected).toBe('/library');

		const member = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, orgId, existing.id);
		expect(member?.role).toBe('member');

		// One account, not two — the whole point of the branch.
		const page = await tp.config.auth.listUsers({ limit: 200 });
		const matches = page!.items.filter((u) => u.email === 'carol@acme.test');
		expect(matches).toHaveLength(1);
	});

	// The token proves the invite is genuine, not that the visitor is its
	// addressee. Anyone can forward a link; only the account holder may join.
	it('refuses an anonymous visitor holding the link', async () => {
		tp = await freshProviders();
		await seedUser(tp, 'carol@acme.test');
		const { token, orgId } = await mintForExisting(tp, 'carol@acme.test');

		const result = await submit(token, {});
		expect(result.status).toBe(401);
		expect(result.error).toMatch(/sign in as/i);

		const members = await tp.config.data.orgs.listOrgMembers(SYSTEM_CONTEXT, orgId);
		expect(members.items.map((m) => m.userId)).not.toContain('carol@acme.test');
	});

	it('refuses a signed-in user who is not the invitee', async () => {
		tp = await freshProviders();
		await seedUser(tp, 'carol@acme.test');
		const impostor = await seedUser(tp, 'mallory@acme.test');
		const { token, orgId } = await mintForExisting(tp, 'carol@acme.test');

		const result = await submit(
			token,
			{},
			{ user: { id: impostor.id, email: 'mallory@acme.test' } }
		);
		expect(result.status).toBe(401);

		const member = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, orgId, impostor.id);
		expect(member).toBeFalsy();
	});

	// `addOrgMember` upserts, so an unguarded re-accept would rewrite the role a
	// `member` invite names over whatever the user already holds.
	it('does not demote someone who is already a member of that org', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);
		const res = await call(mintInvite, {
			locals: aliceLocals,
			params: { orgId: acme.id },
			body: { email: 'alice@acme.test', orgRole: 'member', permissions: [] }
		});
		expect(res.status).toBe(201);
		const token = new URL((res.json as { acceptUrl: string }).acceptUrl).searchParams.get('token')!;

		await submit(token, {}, { user: { id: alice.id, email: 'alice@acme.test' } });

		const member = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, alice.id);
		expect(member?.role).toBe('admin');
	});
});

describe('accept-invite display name', () => {
	/**
	 * Regression: `updateProfile` patches an existing data-layer row and 404s on
	 * a missing one. A brand-new invitee has no row yet — `ensureUser` normally
	 * seeds it on the first authed request, which has not happened at signup —
	 * so the write returned `not_found` and the name the invitee typed was
	 * dropped without a trace. The UI then fell back to the email local part,
	 * which looks like the field was ignored.
	 */
	it('persists the display name a new invitee typed', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const res = await submit(token, {
			password: PASSWORD,
			confirm: PASSWORD,
			displayName: 'Felix Brunold'
		});
		expect(res.redirected).toBeDefined();

		const user = await findAuthUserByEmail(tp.config.auth, INVITEE);
		const profile = await tp.config.data.userProfile.getProfile(SYSTEM_CONTEXT, user!.id);
		expect(profile?.displayName).toBe('Felix Brunold');
	});

	it('leaves the profile alone when no display name is given', async () => {
		tp = await freshProviders();
		const token = await mintFor(tp);

		const res = await submit(token, { password: PASSWORD, confirm: PASSWORD });
		expect(res.redirected).toBeDefined();

		const user = await findAuthUserByEmail(tp.config.auth, INVITEE);
		const profile = await tp.config.data.userProfile.getProfile(SYSTEM_CONTEXT, user!.id);
		expect(profile?.displayName ?? null).toBeNull();
	});
});
