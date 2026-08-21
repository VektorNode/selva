/**
 * Audit Q5.5 — privilege escalation via member PATCH.
 *
 * The sibling `patch-member.test.ts` covers the happy paths and the headline
 * denials. This file is adversarial: it asks whether an **admin** can use this
 * endpoint to become — or to manufacture — an owner.
 *
 * Why the boundary is subtle. Owner and admin hold *identical* default
 * permissions (`DEFAULT_ORG_PERMISSIONS` grants both the full set), so "owner"
 * is not expressible as a permission an attacker could grant themselves. The
 * only thing separating them is the **role**, gated at exactly one place —
 * `if (actorMember.role !== 'owner')` on the role-change branch. That single
 * check is the entire owner/admin boundary, so each way around it gets a test:
 *
 *   - admin promotes self to owner            → must 403
 *   - admin promotes a peer admin to owner    → must 403
 *   - admin demotes the real owner            → must 403
 *   - admin sends role + permissions together → must 403, and must not apply
 *     the permissions half either (no partial application on a refused request)
 *
 * The last one matters most: the handler runs the role branch and the
 * permissions branch in sequence, so a refusal in the first must abort the
 * request rather than fall through to the second.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { freshHarness, type HandlerHarness } from './harness.js';
import { seedUser, seedOrgMember, seedAcme, actAs, callHandler } from '../../testing/index.js';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { updateOrgMember } from '../orgMembers.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** Acme + a real owner-role user + `admin` (an admin-role actor). */
async function seedOrgWithOwnerAndAdmin() {
	const { acme, alice, bob } = await seedAcme(tp!);
	const owner = await seedUser(tp!, 'owner@acme.test');
	await seedOrgMember(tp!, { orgId: acme.id, userId: owner.id, role: 'owner' });
	// `alice` is seeded as an admin of acme by seedAcme.
	return { acme, owner, admin: alice, member: bob };
}

describe('PATCH member — an admin cannot cross the owner boundary (Q5.5)', () => {
	it('refuses an admin promoting THEMSELVES to owner', async () => {
		tp = await freshHarness();
		const { acme, admin } = await seedOrgWithOwnerAndAdmin();

		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, admin.id),
			params: { orgId: acme.id, userId: admin.id },
			body: { role: 'owner' }
		});

		expect(res.status).toBe(403);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, admin.id);
		expect(after?.role).toBe('admin');
	});

	it('refuses an admin promoting a PEER admin to owner', async () => {
		tp = await freshHarness();
		const { acme, admin } = await seedOrgWithOwnerAndAdmin();
		const peer = await seedUser(tp, 'peer-admin@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: peer.id, role: 'admin' });

		// Minting an owner indirectly is the same escalation, one step removed.
		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, admin.id),
			params: { orgId: acme.id, userId: peer.id },
			body: { role: 'owner' }
		});

		expect(res.status).toBe(403);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, peer.id);
		expect(after?.role).toBe('admin');
	});

	it('refuses an admin demoting the real owner', async () => {
		tp = await freshHarness();
		const { acme, owner, admin } = await seedOrgWithOwnerAndAdmin();

		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, admin.id),
			params: { orgId: acme.id, userId: owner.id },
			body: { role: 'member' }
		});

		expect(res.status).toBe(403);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, owner.id);
		expect(after?.role).toBe('owner');
	});

	it('refuses an admin promoting a plain member to owner', async () => {
		tp = await freshHarness();
		const { acme, admin, member } = await seedOrgWithOwnerAndAdmin();

		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, admin.id),
			params: { orgId: acme.id, userId: member.id },
			body: { role: 'owner' }
		});

		expect(res.status).toBe(403);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, member.id);
		expect(after?.role).toBe('member');
	});

	it('applies NEITHER half when a role+permissions request is refused', async () => {
		tp = await freshHarness();
		const { acme, admin, member } = await seedOrgWithOwnerAndAdmin();

		// The role branch must reject the whole request — not reject the role and
		// then quietly apply the permissions. Grant-worthy perms are used here so
		// that a fall-through would be visibly wrong rather than a no-op.
		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, admin.id),
			params: { orgId: acme.id, userId: member.id },
			body: { role: 'owner', permissions: ['manage_definitions'] }
		});

		expect(res.status).toBe(403);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, member.id);
		expect(after?.role).toBe('member');
		expect(after?.permissions ?? []).not.toContain('manage_definitions');
	});
});

describe('PATCH member — what an admin legitimately may do (guards against over-tightening)', () => {
	it('lets an admin grant a member the member-assignable permissions', async () => {
		tp = await freshHarness();
		const { acme, admin, member } = await seedOrgWithOwnerAndAdmin();

		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, admin.id),
			params: { orgId: acme.id, userId: member.id },
			body: { permissions: ['manage_definitions', 'manage_projects'] }
		});

		expect(res.status).toBe(204);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, member.id);
		expect(after?.permissions).toEqual(
			expect.arrayContaining(['manage_definitions', 'manage_projects'])
		);
	});

	it('refuses governance permissions on a member-role target regardless of actor', async () => {
		tp = await freshHarness();
		const { acme, owner, member } = await seedOrgWithOwnerAndAdmin();

		// Even the OWNER cannot park an owner/admin-only permission on someone
		// whose role is `member` — the role/permission sets must stay coherent,
		// otherwise `member` becomes a de-facto admin without the role.
		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, owner.id),
			params: { orgId: acme.id, userId: member.id },
			body: { permissions: ['manage_org_members'] }
		});

		expect(res.status).toBe(400);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, member.id);
		expect(after?.permissions ?? []).not.toContain('manage_org_members');
	});

	it('lets the owner promote a member and grant governance perms in one request', async () => {
		tp = await freshHarness();
		const { acme, owner, member } = await seedOrgWithOwnerAndAdmin();

		// The `effectiveRole = patch.role ?? target.role` path: the permission is
		// illegal for the CURRENT role but legal for the requested one, so the
		// combined request must be judged against the new role.
		const res = await callHandler(updateOrgMember, {
			locals: await actAs(tp, owner.id),
			params: { orgId: acme.id, userId: member.id },
			body: { role: 'admin', permissions: ['manage_org_members'] }
		});

		expect(res.status).toBe(204);
		const after = await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, member.id);
		expect(after?.role).toBe('admin');
		expect(after?.permissions).toEqual(expect.arrayContaining(['manage_org_members']));
	});
});
