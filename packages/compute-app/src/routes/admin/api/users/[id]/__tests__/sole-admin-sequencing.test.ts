/**
 * Spec §2 / §10 — sole-`instance_admin` invariant route sequencing.
 *
 * The handler MUST consult `IPlatformPermissionStore.countInstanceAdminsExcluding`
 * BEFORE calling the auth provider, because the auth provider only handles
 * identity and doesn't know about Selva permissions. If the order were
 * inverted, the user could be deleted from auth before the invariant fires —
 * leaving an unrecoverable instance with zero admins.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '../../../../../../lib/server/__tests__/fixtures.js';
import { DELETE, PATCH } from '../+server.js';
import { POST as DISABLE } from '../disable/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('§2 sole-admin invariant — DELETE /admin/api/users/[id]', () => {
	it('deleting the sole instance_admin returns 409 and does NOT touch the auth provider', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(DELETE, { locals: aliceLocals, params: { id: alice.id } });
		expect(res.status).toBe(409);
		expect((res.json as { message: string }).message).toMatch(/last instance admin/i);

		// Auth provider was NOT called — Alice still exists.
		const stillThere = await tp.usersFile.findById(alice.id);
		expect(stillThere).not.toBeNull();
	});

	it('deleting one of two admins succeeds — count excludes the target correctly', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(DELETE, { locals: aliceLocals, params: { id: bob.id } });
		expect(res.status).toBe(200);

		const bobAfter = await tp.usersFile.findById(bob.id);
		expect(bobAfter).toBeNull();
	});
});

describe('§2 sole-admin invariant — POST /admin/api/users/[id]/disable', () => {
	it('disabling the sole instance_admin returns 409 and does NOT touch the auth provider', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(DISABLE, { locals: aliceLocals, params: { id: alice.id } });
		expect(res.status).toBe(409);
		expect((res.json as { message: string }).message).toMatch(/last instance admin/i);

		const stillEnabled = await tp.usersFile.findById(alice.id);
		expect(stillEnabled?.disabled).not.toBe(true);
	});

	it('disabling one of two admins succeeds', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(DISABLE, { locals: aliceLocals, params: { id: bob.id } });
		expect(res.status).toBe(200);

		const bobAfter = await tp.usersFile.findById(bob.id);
		expect(bobAfter?.disabled).toBe(true);
	});
});

describe('§2 sole-admin invariant — PATCH /admin/api/users/[id] permissions', () => {
	it('revoking instance_admin from the sole admin returns 409 last_admin', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals: aliceLocals,
			params: { id: alice.id },
			body: { permissions: [] }
		});
		expect(res.status).toBe(409);
		expect((res.json as { message: string }).message).toMatch(/last instance admin/i);

		const after = await tp.config.permissions.getFor(aliceLocals.ctx, alice.id);
		expect(after).toContain('instance_admin');
	});
});
