/**
 * How `POST /api/admin/users` creates a user depends entirely on which surface
 * the auth provider exposes, and the two branches mean very different things:
 *
 *   - `passwordAuth` present (Local, Supabase) — the ADMIN picks the new user's
 *     password and it travels to the server.
 *   - `passwordAuth` absent but `createUser` present (header-auth/Entra) — there
 *     is no password at all. The row is a UPN allowlist entry; the IdP owns the
 *     credential and proves identity on the next request.
 *
 * The second branch is the ONLY way to admit a user to a header-auth
 * deployment, and it has had no route-level test. These pin it, so that
 * reworking the password branch cannot quietly take the allowlist path with it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { POST } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/**
 * Reshape the auth provider for one test.
 *
 * `createUser` returns a real row from the local store so everything
 * downstream (permission grant, org membership) operates on a user that
 * actually exists — the point is to exercise the route, not to stub past it.
 */
function useProxyAuthProvider(providers: TestProviders) {
	const config = providers.config as unknown as { auth: Record<string, unknown> };
	const createUser = vi.fn(async (email: string) => {
		const user = await providers.authUsers.createUser(email, null);
		return { id: user.id, email: user.email, displayName: user.displayName ?? null };
	});
	const createUserWithPassword = vi.fn();

	config.auth = {
		name: 'header-auth',
		// No passwordAuth: this is what makes the route take the allowlist branch.
		createUser,
		proxyAuth: { hasNoIdentityHeaders: () => false },
		verifyToken: async () => null
	};
	return { createUser, createUserWithPassword };
}

describe('POST /api/admin/users — header-auth (no passwordAuth)', () => {
	it('allowlists via createUser and never asks for a password', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		const { createUser, createUserWithPassword } = useProxyAuthProvider(tp);

		const res = await call(POST, {
			locals,
			// No password field — under header-auth there is nothing to set.
			body: { email: 'newcomer@example.dev', permissions: [] }
		});

		expect(res.status).toBe(201);
		expect(createUser).toHaveBeenCalledWith('newcomer@example.dev');
		expect(createUserWithPassword).not.toHaveBeenCalled();
	});

	it('admits the user without a password even when one is supplied', async () => {
		// A stale client could still send `password`. The allowlist branch must
		// ignore it rather than fail — there is no credential store to put it in.
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		const { createUser } = useProxyAuthProvider(tp);

		const res = await call(POST, {
			locals,
			body: { email: 'ignored-pw@example.dev', password: 'hunter2hunter2', permissions: [] }
		});

		expect(res.status).toBe(201);
		expect(createUser).toHaveBeenCalledWith('ignored-pw@example.dev');
	});

	it('attaches the new user to the acting org as a member', async () => {
		// The allowlist row alone grants identity, not access — without the org
		// membership the user authenticates and then sees nothing.
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		useProxyAuthProvider(tp);

		const res = await call(POST, {
			locals,
			body: { email: 'member@example.dev', permissions: [] }
		});
		expect(res.status).toBe(201);

		const created = res.json as { id: string };
		const members = await tp.config.data.orgs.listOrgMembers(SYSTEM_CONTEXT, acme.id);
		const row = members.items.find((m) => m.userId === created.id);
		expect(row?.role).toBe('member');
	});

	it('reaches the platform-permission grant on the allowlist path', async () => {
		// Promoting an Entra user to instance_admin goes through this same route,
		// and the grant is out-of-band of the auth provider either way.
		//
		// Asserts the call, not the stored value: the permission store keys on a
		// profile row that only `ensureUser` creates, and this stubbed provider
		// creates the auth row alone. What matters here is that the allowlist
		// branch doesn't skip the grant the password branch performs.
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		useProxyAuthProvider(tp);
		const setPerms = vi.spyOn(tp.config.data.permissions, 'set');

		const res = await call(POST, {
			locals,
			body: { email: 'second-admin@example.dev', permissions: ['instance_admin'] }
		});
		expect(res.status).toBe(201);

		const created = res.json as { id: string };
		expect(setPerms).toHaveBeenCalledWith(expect.anything(), created.id, ['instance_admin']);
	});

	it('refuses platform permissions from a caller who is not a platform admin', async () => {
		// The same 403 the password branch enforces — an org admin must not be
		// able to mint an instance_admin by going through the allowlist path.
		tp = await freshProviders();
		const { bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, bob.id, ['manage_instance_users']);
		const locals = await actAs(tp, bob.id);

		useProxyAuthProvider(tp);

		const res = await call(POST, {
			locals,
			body: { email: 'escalation@example.dev', permissions: ['instance_admin'] }
		});

		expect(res.status).toBe(403);
	});
});

describe('POST /api/admin/users — provider exposes neither surface', () => {
	it('reports 501 rather than half-creating anything', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		const config = tp.config as unknown as { auth: Record<string, unknown> };
		config.auth = { name: 'external-idp', verifyToken: async () => null };

		const res = await call(POST, {
			locals,
			body: { email: 'nobody@example.dev', permissions: [] }
		});

		expect(res.status).toBe(501);
		expect((res.json as { message: string }).message).toMatch(/not supported by external-idp/i);
	});
});
