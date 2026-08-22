/**
 * Finding 20 — two defects in the same file, both in the sole-owner invariant.
 *
 * 1. DELETE lacked the owner-only gate PATCH has. §3 makes role changes
 *    owner-only, and PATCH enforced it: an admin demoting an owner got 403.
 *    DELETE removed that same owner outright for 204, whenever a second owner
 *    existed to satisfy the sole-owner check. The harder-to-reverse of the two
 *    operations was the less guarded one.
 *
 * 2. `hasAnotherOwner` read one 200-row page with no cursor loop, so a second
 *    owner past the first page read as "no other owner" and the invariant
 *    refused an operation that was actually safe. It failed closed, which is
 *    the right direction — but it made an org unadministrable precisely when it
 *    had grown enough to need administering.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, seedOrgMember, seedUser, actAs, callHandler } from '../../testing/index.js';
import { removeOrgMember } from '../orgMembers.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/**
 * `seedAcme` makes Alice the org's `ownerId` but seeds her membership row as
 * `admin` — the two are separate, which is what finding 12 was about. The gate
 * under test reads the membership row, so an owner has to be seeded explicitly.
 */
async function seedOwner(orgId: string, email: string) {
	const user = await seedUser(tp!, email);
	await seedOrgMember(tp!, { orgId, userId: user.id, role: 'owner' });
	return user;
}

describe('DELETE /api/v1/orgs/{orgId}/members/{userId} — owner removal', () => {
	it('refuses to let an org admin remove an owner', async () => {
		tp = await freshHarness();
		const { acme, alice } = await seedAcme(tp);

		// Alice is an org admin holding `manage_org_members`, so she clears the
		// route's own gate and a 403 can only come from the owner-only check under
		// test. A plain member would be refused at the first gate and prove nothing.
		await seedOrgMember(tp, {
			orgId: acme.id,
			userId: alice.id,
			role: 'admin',
			permissions: ['manage_org_members']
		});
		const owner = await seedOwner(acme.id, 'owner@acme.test');
		// A second owner, so the sole-owner check cannot be what refuses.
		await seedOwner(acme.id, 'coowner@acme.test');

		const res = await callHandler(removeOrgMember, {
			locals: await actAs(tp, alice.id),
			params: { orgId: acme.id, userId: owner.id }
		});

		expect(res.status).toBe(403);
	});

	it('lets an owner remove another owner', async () => {
		tp = await freshHarness();
		const { acme } = await seedAcme(tp);
		const owner = await seedOwner(acme.id, 'owner@acme.test');
		const coOwner = await seedOwner(acme.id, 'coowner@acme.test');

		// The positive control: the gate must narrow to non-owners, not deny
		// owner removal outright.
		const res = await callHandler(removeOrgMember, {
			locals: await actAs(tp, owner.id),
			params: { orgId: acme.id, userId: coOwner.id }
		});

		expect(res.status).toBe(204);
	});

	it('lets an org admin remove a non-owner', async () => {
		tp = await freshHarness();
		const { acme, bob } = await seedAcme(tp);
		const admin = await seedUser(tp, 'admin@acme.test');
		await seedOrgMember(tp, {
			orgId: acme.id,
			userId: admin.id,
			role: 'admin',
			permissions: ['manage_org_members']
		});

		// The other control: the new gate keys on the *target* being an owner, so
		// ordinary offboarding by an admin must still work.
		const res = await callHandler(removeOrgMember, {
			locals: await actAs(tp, admin.id),
			params: { orgId: acme.id, userId: bob.id }
		});

		expect(res.status).toBe(204);
	});

	it('still refuses to remove the sole owner', async () => {
		tp = await freshHarness();
		const { acme } = await seedAcme(tp);
		const owner = await seedOwner(acme.id, 'owner@acme.test');

		const res = await callHandler(removeOrgMember, {
			locals: await actAs(tp, owner.id),
			params: { orgId: acme.id, userId: owner.id }
		});

		expect(res.status).toBe(409);
	});

	it('finds a second owner sitting past the first roster page', async () => {
		tp = await freshHarness();
		const { acme } = await seedAcme(tp);
		const owner = await seedOwner(acme.id, 'owner@acme.test');
		const coOwner = await seedOwner(acme.id, 'coowner@acme.test');

		// Force the co-owner off page one. Capping the page at a single row is the
		// shape of a 200-row truncation on a large org: the second owner exists,
		// and only a cursor loop reaches them.
		const orgs = tp.config.data.orgs;
		const realList = orgs.listOrgMembers.bind(orgs);
		vi.spyOn(orgs, 'listOrgMembers').mockImplementation(async (ctx, orgId, opts) => {
			const all = await realList(ctx, orgId, { ...opts, limit: 500 });
			const start = opts?.cursor ? Number(opts.cursor) : 0;
			const items = all.items.slice(start, start + 1);
			const next = start + 1 < all.items.length ? String(start + 1) : undefined;
			return { items, nextCursor: next };
		});

		// An owner removing a co-owner; with the single-page read this came back
		// 409 ("sole owner") even though the co-owner is right there on page two.
		const res = await callHandler(removeOrgMember, {
			locals: await actAs(tp, owner.id),
			params: { orgId: acme.id, userId: coOwner.id }
		});

		expect(res.status).toBe(204);
	});
});
