/**
 * Finding 6 — platform-scope mutations must leave an audit trail.
 *
 * `instance_admin` is the one grant that reaches every tenant's data, so the
 * self-elevate → act → revoke sequence is the attack these events exist to
 * make visible. Before this, that sequence wrote zero rows to `audit_events`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SYSTEM_CONTEXT, type DomainEvent } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { DELETE, PATCH } from '../[id]/+server.js';
import { POST as DISABLE } from '../[id]/disable/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

function eventsOfType<T extends DomainEvent['type']>(
	events: TestProviders['events'],
	type: T
): Extract<DomainEvent, { type: T }>[] {
	return events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
}

describe('finding 6 — platform-scope events', () => {
	it('granting instance_admin emits platform_permissions.changed naming actor and target', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals: aliceLocals,
			params: { id: bob.id },
			body: { permissions: ['instance_admin'] }
		});
		expect(res.status).toBe(204);

		const emitted = eventsOfType(tp.events, 'platform_permissions.changed');
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			userId: bob.id,
			actorId: alice.id,
			permissions: ['instance_admin']
		});
	});

	it('the self-elevate then revoke sequence leaves both halves in the trail', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		await call(PATCH, {
			locals: aliceLocals,
			params: { id: bob.id },
			body: { permissions: ['instance_admin'] }
		});
		await call(PATCH, {
			locals: aliceLocals,
			params: { id: bob.id },
			body: { permissions: [] }
		});

		// Revoking the grant must not erase the evidence it was ever made.
		const emitted = eventsOfType(tp.events, 'platform_permissions.changed');
		expect(emitted.map((e) => e.permissions)).toEqual([['instance_admin'], []]);
	});

	it('a refused permission change emits nothing', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		// Sole admin self-revoking — refused with 409, so nothing changed and
		// nothing should be recorded as having changed.
		const res = await call(PATCH, {
			locals: aliceLocals,
			params: { id: alice.id },
			body: { permissions: [] }
		});
		expect(res.status).toBe(409);
		expect(eventsOfType(tp.events, 'platform_permissions.changed')).toHaveLength(0);
	});

	it('disabling a user emits user.disabled', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(DISABLE, { locals: aliceLocals, params: { id: bob.id } });
		expect(res.status).toBe(204);

		expect(eventsOfType(tp.events, 'user.disabled')).toMatchObject([
			{ userId: bob.id, actorId: alice.id }
		]);
	});

	it('deleting a user emits user.deleted after the erasure pass', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(DELETE, { locals: aliceLocals, params: { id: bob.id } });
		expect(res.status).toBe(204);

		expect(eventsOfType(tp.events, 'user.deleted')).toMatchObject([
			{ userId: bob.id, actorId: alice.id }
		]);
	});

	it('refuses deleting the only owner of an org', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, alice.id, 'owner');

		const res = await call(DELETE, { locals: await actAs(tp, bob.id), params: { id: alice.id } });

		expect(res.status).toBe(409);
		expect(res.json).toMatchObject({ message: expect.stringContaining('Acme') });
		expect(
			await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, alice.id)
		).not.toBeNull();
	});

	it('deletes an owner once the org has another', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, alice.id, 'owner');
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, bob.id, 'owner');

		const res = await call(DELETE, { locals: await actAs(tp, bob.id), params: { id: alice.id } });

		expect(res.status).toBe(204);
	});

	it('two admins deleting each other leave one standing', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		const [la, lb] = await Promise.all([actAs(tp, alice.id), actAs(tp, bob.id)]);

		const results = await Promise.all([
			call(DELETE, { locals: la, params: { id: bob.id } }),
			call(DELETE, { locals: lb, params: { id: alice.id } })
		]);

		expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(true);
	});

	it('gives an admin their permissions back when the delete does not happen', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin', 'manage_compute']);
		const locals = await actAs(tp, alice.id);
		vi.spyOn(tp.config.auth, 'deleteUser').mockResolvedValueOnce('not_supported');

		const res = await call(DELETE, { locals, params: { id: bob.id } });

		expect(res.status).toBe(501);
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, bob.id)).toEqual([
			'instance_admin',
			'manage_compute'
		]);
	});

	it('refuses making a disabled user an instance admin', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);
		await tp.config.auth.disableUser!(bob.id);

		const res = await call(PATCH, {
			locals,
			params: { id: bob.id },
			body: { permissions: ['instance_admin'] }
		});

		expect(res.status).toBe(409);
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, bob.id)).toEqual([]);
	});

	it("still lets an admin change a disabled user's other permissions", async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);
		await tp.config.auth.disableUser!(bob.id);

		const res = await call(PATCH, {
			locals,
			params: { id: bob.id },
			body: { permissions: ['manage_compute'] }
		});

		expect(res.status).toBe(204);
	});
});
