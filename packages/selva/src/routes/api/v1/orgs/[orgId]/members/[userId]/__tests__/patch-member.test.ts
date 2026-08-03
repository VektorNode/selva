/**
 * Spec §3 — owner vs admin distinction enforced at the API layer.
 *
 * Verifies:
 *   - Owner can change a member's role
 *   - Admin cannot change roles (403)
 *   - Owner+admin can grant `manage_definitions` / `manage_projects` to a member
 *   - Member-role users reject owner-admin-only permissions (400)
 *   - Cross-tenant: actor in BigClient cannot mutate Acme members (403)
 *   - Sole-owner cannot be demoted (409)
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedUser,
	seedOrg,
	seedOrgMember,
	seedAcme,
	seedBigClient,
	actAs,
	call,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { PATCH } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('PATCH /api/orgs/[orgId]/members/[userId]', () => {
	it("owner can change a member's role to admin", async () => {
		tp = await freshProviders();
		// seedAcme gives alice@acme as admin and bob@acme as member, plus an
		// org whose ownerId points at alice. Add a real owner-role user so the
		// owner-only path has a subject. Use SYSTEM_CONTEXT for the seed
		// because actor-context isn't established yet.
		const { acme, bob } = await seedAcme(tp);
		const owner = await seedUser(tp, 'owner@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: owner.id, role: 'owner' });

		const ownerLocals = await actAs(tp, owner.id);

		const res = await call(PATCH, {
			locals: ownerLocals,
			params: { orgId: acme.id, userId: bob.id },
			body: { role: 'admin' }
		});
		expect(res.status).toBe(204);

		const updated = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, bob.id);
		expect(updated?.role).toBe('admin');
	});

	it('admin cannot change roles', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals: aliceLocals,
			params: { orgId: acme.id, userId: bob.id },
			body: { role: 'admin' }
		});
		expect(res.status).toBe(403);

		const unchanged = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, bob.id);
		expect(unchanged?.role).toBe('member');
	});

	it('admin can grant member permissions', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals: aliceLocals,
			params: { orgId: acme.id, userId: bob.id },
			body: { permissions: ['manage_definitions', 'manage_projects'] }
		});
		expect(res.status).toBe(204);

		const updated = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, bob.id);
		expect(updated?.permissions).toEqual(
			expect.arrayContaining(['manage_definitions', 'manage_projects'])
		);
	});

	it('member-role target rejects owner-admin-only permissions', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals: aliceLocals,
			params: { orgId: acme.id, userId: bob.id },
			body: { permissions: ['manage_org_members'] }
		});
		expect(res.status).toBe(400);
	});

	it('cross-tenant: BigClient member cannot mutate Acme members even via direct URL', async () => {
		tp = await freshProviders();
		const { acme, bob } = await seedAcme(tp);
		const { carol } = await seedBigClient(tp);
		const carolLocals = await actAs(tp, carol.id);

		const res = await call(PATCH, {
			locals: carolLocals,
			params: { orgId: acme.id, userId: bob.id },
			body: { role: 'admin' }
		});
		// Carol holds no manage_org_members in Acme — `requireManageOrgMembers`
		// fails before the tenancy check, so this is 403 either way.
		expect(res.status).toBe(403);
	});

	it('cannot demote the sole owner of the org', async () => {
		tp = await freshProviders();
		// Custom org with a single owner. Owner demotes themselves → blocked.
		const owner = await seedUser(tp, 'sole@example.test');
		const org = await seedOrg(tp, { name: 'Solo', slug: 'solo', ownerId: owner.id });
		await seedOrgMember(tp, { orgId: org.id, userId: owner.id, role: 'owner' });

		const ownerLocals = await actAs(tp, owner.id);

		const res = await call(PATCH, {
			locals: ownerLocals,
			params: { orgId: org.id, userId: owner.id },
			body: { role: 'member' }
		});
		expect(res.status).toBe(409);

		const stillOwner = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, org.id, owner.id);
		expect(stillOwner?.role).toBe('owner');
	});

	it('owner can transfer by promoting a second user — sole-owner check passes when ≥2 owners exist', async () => {
		tp = await freshProviders();
		const { acme, bob } = await seedAcme(tp);
		const owner = await seedUser(tp, 'owner@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: owner.id, role: 'owner' });

		const ownerLocals = await actAs(tp, owner.id);

		// Promote Bob to owner (now 2 owners)
		const promote = await call(PATCH, {
			locals: ownerLocals,
			params: { orgId: acme.id, userId: bob.id },
			body: { role: 'owner' }
		});
		expect(promote.status).toBe(204);

		// Now demote original owner (Bob remains as second owner)
		const demote = await call(PATCH, {
			locals: ownerLocals,
			params: { orgId: acme.id, userId: owner.id },
			body: { role: 'member' }
		});
		expect(demote.status).toBe(204);
	});
});
