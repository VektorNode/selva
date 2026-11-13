/**
 * Deleting or disabling a user must not leave something nobody can repair: an
 * org with no usable owner, an admin stripped of their grant by an action that
 * failed, or personal data that survives because the first attempt broke.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	actAs,
	call,
	freshProviders,
	grantPlatformPermissions,
	seedAcme,
	seedOrg,
	seedOrgMember,
	seedUser,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { PATCH as PATCH_MEMBER } from '../../../../v1/orgs/[orgId]/members/[userId]/+server.js';
import { DELETE } from '../+server.js';
import { POST as DISABLE } from '../disable/+server.js';

let tp: TestProviders | null = null;
afterEach(async () => {
	vi.restoreAllMocks();
	await tp?.cleanup();
	tp = null;
});

/** Root (instance admin), plus an org whose owners are the given users. */
async function orgOwnedBy(owners: string[]) {
	tp = await freshProviders();
	const root = await seedUser(tp, 'root@acme.test');
	await grantPlatformPermissions(tp, root.id, ['instance_admin']);
	const users = [];
	for (const email of owners) users.push(await seedUser(tp, email));
	const org = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: users[0].id });
	for (const user of users) {
		await seedOrgMember(tp, { orgId: org.id, userId: user.id, role: 'owner' });
	}
	return { root, users, org };
}

describe('an org keeps a usable owner', () => {
	it("refuses disabling an org's only owner, as delete does", async () => {
		const { root, users } = await orgOwnedBy(['owner@acme.test']);

		const res = await call(DISABLE, {
			locals: await actAs(tp!, root.id),
			method: 'POST',
			params: { id: users[0].id }
		});

		expect(res.status).toBe(409);
		expect((await tp!.config.auth.getUser(users[0].id))?.disabled).not.toBe(true);
	});

	it('does not count a disabled co-owner as the one who stays', async () => {
		const { root, users } = await orgOwnedBy(['a@acme.test', 'b@acme.test']);
		const as = await actAs(tp!, root.id);

		expect(
			(await call(DISABLE, { locals: as, method: 'POST', params: { id: users[0].id } })).status
		).toBe(204);
		expect(
			(await call(DISABLE, { locals: as, method: 'POST', params: { id: users[1].id } })).status
		).toBe(409);
		expect(
			(await call(DELETE, { locals: as, method: 'DELETE', params: { id: users[1].id } })).status
		).toBe(409);
	});

	it('keeps an owner when one is deleted while the other steps down', async () => {
		for (let round = 0; round < 10; round++) {
			const { root, users, org } = await orgOwnedBy(['a@acme.test', 'b@acme.test']);
			const [a, b] = users;

			await Promise.all([
				call(DELETE, {
					locals: await actAs(tp!, root.id),
					method: 'DELETE',
					params: { id: a.id }
				}),
				call(PATCH_MEMBER, {
					locals: await actAs(tp!, b.id),
					method: 'PATCH',
					params: { orgId: org.id, userId: b.id },
					body: { role: 'member' }
				})
			]);

			const members = await tp!.config.data.orgs.listOrgMembers(SYSTEM_CONTEXT, org.id, {
				limit: 50
			});
			expect(members.items.filter((m) => m.role === 'owner')).not.toHaveLength(0);
			await tp!.cleanup();
			tp = null;
		}
	});
});

describe('a removal that fails', () => {
	it('gives the target their admin grant back when the delete throws', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		vi.spyOn(tp.config.auth, 'deleteUser').mockRejectedValue(new Error('auth service 503'));

		const res = await call(DELETE, {
			locals: await actAs(tp, alice.id),
			method: 'DELETE',
			params: { id: bob.id }
		});

		expect(res.status).toBe(500);
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, bob.id)).toEqual([
			'instance_admin'
		]);
	});

	it('gives the target their admin grant back when the disable throws', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		vi.spyOn(tp.config.auth, 'disableUser').mockRejectedValue(new Error('auth service 503'));

		const res = await call(DISABLE, { locals: await actAs(tp, alice.id), params: { id: bob.id } });

		expect(res.status).toBe(500);
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, bob.id)).toEqual([
			'instance_admin'
		]);
	});

	it('can be retried to the end when the erasure pass broke once', async () => {
		tp = await freshProviders();
		const { alice, bob, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const data = tp.config.data;
		await data.invites.create(SYSTEM_CONTEXT, {
			id: randomUUID(),
			tokenHash: 'h',
			email: bob.email!,
			orgId: acme.id,
			orgRole: 'member',
			orgPermissions: [],
			platformPermissions: [],
			invitedBy: alice.id,
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 86_400_000).toISOString()
		});
		vi.spyOn(data.apiTokens!, 'eraseUser').mockRejectedValueOnce(new Error('ENOSPC'));
		const del = async () =>
			(
				await call(DELETE, {
					locals: await actAs(tp!, alice.id),
					method: 'DELETE',
					params: { id: bob.id }
				})
			).status;

		expect(await del()).toBe(500);
		expect(await del()).toBe(204);

		expect(await tp.config.auth.getUser(bob.id)).toBeNull();
		expect(await data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, bob.id)).toBeNull();
		const invites = (await data.invites.listByOrg(SYSTEM_CONTEXT, acme.id)).items;
		expect(invites.map((i) => i.email)).not.toContain(bob.email);
	});
});

describe('a delete racing the target', () => {
	it('erases what was written between the erasure and the identity going', async () => {
		tp = await freshProviders();
		const { alice, bob, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const data = tp.config.data;
		const auth = tp.config.auth;
		const realDelete = auth.deleteUser.bind(auth);
		vi.spyOn(auth, 'deleteUser').mockImplementation(async (id) => {
			await data.invites.create(SYSTEM_CONTEXT, {
				id: randomUUID(),
				tokenHash: 'late',
				email: bob.email!,
				orgId: acme.id,
				orgRole: 'member',
				orgPermissions: [],
				platformPermissions: [],
				invitedBy: alice.id,
				createdAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 86_400_000).toISOString()
			});
			return realDelete(id);
		});

		const res = await call(DELETE, {
			locals: await actAs(tp, alice.id),
			method: 'DELETE',
			params: { id: bob.id }
		});

		expect(res.status).toBe(204);
		const invites = (await data.invites.listByOrg(SYSTEM_CONTEXT, acme.id)).items;
		expect(invites.map((i) => i.email)).not.toContain(bob.email);
	});
});
