import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedBigClient,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { DELETE } from '../+server.js';

/**
 * Deleting a user erases what names them beyond the identity row: an identity
 * provider deletion alone leaves their memberships, the invites addressed to
 * them and their profile behind.
 */

let tp: TestProviders | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

async function inviteTo(orgId: string, email: string, invitedBy: string) {
	await tp!.config.data.invites.create(SYSTEM_CONTEXT, {
		id: randomUUID(),
		tokenHash: `hash-${randomUUID()}`,
		email,
		orgId,
		orgRole: 'member',
		orgPermissions: [],
		platformPermissions: [],
		invitedBy,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 86_400_000).toISOString()
	});
}

describe('DELETE /api/admin/users/[id] erases the user', () => {
	it('removes their memberships, the invites addressed to them and their profile', async () => {
		tp = await freshProviders();
		const { alice, bob, acme } = await seedAcme(tp);
		const { bigClient, carol } = await seedBigClient(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await inviteTo(bigClient.id, bob.email, carol.id);
		const data = tp.config.data;

		expect(await data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, bob.id)).not.toBeNull();
		expect(await data.userProfile.getProfile(SYSTEM_CONTEXT, bob.id)).not.toBeNull();
		const invitedBefore = await data.invites.listByOrg(SYSTEM_CONTEXT, bigClient.id);
		expect(invitedBefore.items.map((i) => i.email)).toContain(bob.email);

		const res = await call(DELETE, {
			locals: await actAs(tp, alice.id),
			params: { id: bob.id },
			method: 'DELETE'
		});
		expect(res.status).toBe(204);

		expect(await data.orgs.findUserMembership(SYSTEM_CONTEXT, bob.id)).toBeNull();
		expect(await data.userProfile.getProfile(SYSTEM_CONTEXT, bob.id)).toBeNull();
		const invitedAfter = await data.invites.listByOrg(SYSTEM_CONTEXT, bigClient.id);
		expect(invitedAfter.items.map((i) => i.email)).not.toContain(bob.email);
	});
});
