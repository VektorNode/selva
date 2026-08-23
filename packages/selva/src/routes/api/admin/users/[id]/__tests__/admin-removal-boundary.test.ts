/**
 * Two invariants meet on these routes.
 *
 * §2 — removing an instance admin's access is a platform-scope permission
 * change, so `manage_instance_users` alone must not authorize it. PATCH always
 * enforced that; DELETE and disable did not, and only failed because a pre-read
 * happened to throw a 500.
 *
 * §2 again — the instance must never reach zero enabled admins. On the local
 * provider the permission store cannot see the auth provider's `disabled` flag,
 * so a disabled admin still counted as live: disabling two admins in sequence
 * passed both checks and left zero.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedUser,
	grantPlatformPermissions,
	actAs,
	call,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { DELETE } from '../+server.js';
import { POST as DISABLE } from '../disable/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('removing an instance admin requires instance_admin', () => {
	it('refuses DELETE of an admin by a manage_instance_users holder', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		// bob runs the user-admin surface but is NOT a platform admin — the
		// privilege boundary every other test grants both sides of.
		await grantPlatformPermissions(tp, bob.id, ['manage_instance_users']);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, bob.id);

		const res = await call(DELETE, { locals, params: { id: alice.id } });

		expect(res.status).toBe(403);
		expect(await tp.authUsers.findById(alice.id)).not.toBeNull();
	});

	it('refuses disable of an admin by a manage_instance_users holder', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, bob.id, ['manage_instance_users']);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, bob.id);

		const res = await call(DISABLE, { locals, params: { id: alice.id } });

		expect(res.status).toBe(403);
		expect((await tp.authUsers.findById(alice.id))?.disabled).toBeFalsy();
	});

	it('lets a manage_instance_users holder disable an ordinary user', async () => {
		// The permission must remain functional for its stated purpose — it
		// previously returned 500 for everyone.
		tp = await freshProviders();
		const { bob } = await seedAcme(tp);
		const carol = await seedUser(tp, 'carol@acme.test');
		await grantPlatformPermissions(tp, bob.id, ['manage_instance_users']);
		const locals = await actAs(tp, bob.id);

		const res = await call(DISABLE, { locals, params: { id: carol.id } });

		expect(res.status).toBe(204);
		expect((await tp.authUsers.findById(carol.id))?.disabled).toBe(true);
	});
});

describe('disabling admins cannot reach zero', () => {
	it('revokes instance_admin on disable so a disabled admin stops counting', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		// Disable bob: alice remains, so this is allowed.
		const first = await call(DISABLE, { locals, params: { id: bob.id } });
		expect(first.status).toBe(204);

		// Bob's grant is gone, so he can no longer vouch for alice's removal.
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, bob.id)).toEqual([]);

		// Alice is now the last admin — disabling her must be refused.
		const second = await call(DISABLE, { locals, params: { id: alice.id } });
		expect(second.status).toBe(409);

		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(true);
		expect((await tp.authUsers.findById(alice.id))?.disabled).toBeFalsy();
	});
});
