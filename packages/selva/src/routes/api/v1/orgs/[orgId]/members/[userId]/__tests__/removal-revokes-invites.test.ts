/**
 * Finding 8 — removing an org member must disarm their pending invites.
 *
 * `removeOrgMember` cascades `project_members` and stops there. A pending
 * invite stayed live for its full 7-day TTL, so the removed user could accept
 * it and re-enter at their original role — offboarding that undoes itself.
 * Worse in combination with finding 1: dormant `owner` invites minted before
 * the removal survived the removal of the admin who minted them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedOrgMember,
	seedUser,
	actAs,
	callHandler,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { removeOrgMember } from '$lib/server/api/handlers/orgMembers.js';
import { createInvite } from '$lib/server/api/handlers/invites.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** Mint through the real route so the invite is shaped exactly as production makes it. */
async function mintInvite(
	providers: TestProviders,
	locals: Awaited<ReturnType<typeof actAs>>,
	orgId: string,
	email: string
): Promise<void> {
	const res = await callHandler(createInvite, {
		locals,
		params: { orgId },
		body: { email, orgRole: 'member', permissions: [] }
	});
	expect(res.status).toBe(201);
}

describe('DELETE /api/v1/orgs/{orgId}/members/{userId} — pending invites', () => {
	it('revokes the removed member’s pending invites', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);
		await mintInvite(tp, locals, acme.id, bob.email);

		const res = await callHandler(removeOrgMember, {
			locals,
			params: { orgId: acme.id, userId: bob.id }
		});
		expect(res.status).toBe(204);

		const stored = await tp.config.data.invites.listByOrg(SYSTEM_CONTEXT, acme.id, { limit: 100 });
		expect(stored.items.filter((i) => i.email === bob.email && !i.acceptedAt)).toHaveLength(0);
	});

	it('leaves other members’ invites alone', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const carol = await seedUser(tp, 'carol@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: carol.id, role: 'member' });
		const locals = await actAs(tp, alice.id);
		await mintInvite(tp, locals, acme.id, bob.email);
		await mintInvite(tp, locals, acme.id, carol.email);

		await callHandler(removeOrgMember, { locals, params: { orgId: acme.id, userId: bob.id } });

		const stored = await tp.config.data.invites.listByOrg(SYSTEM_CONTEXT, acme.id, { limit: 100 });
		expect(stored.items.map((i) => i.email)).toEqual([carol.email]);
	});

	it('emits invite.revoked so the disarming is auditable', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);
		await mintInvite(tp, locals, acme.id, bob.email);

		await callHandler(removeOrgMember, { locals, params: { orgId: acme.id, userId: bob.id } });

		const revoked = tp.events.filter((e) => e.type === 'invite.revoked');
		expect(revoked).toMatchObject([{ orgId: acme.id, actorId: alice.id }]);
	});

	it('still removes the member when they have no pending invite', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await callHandler(removeOrgMember, {
			locals,
			params: { orgId: acme.id, userId: bob.id }
		});
		expect(res.status).toBe(204);
		expect(await tp.config.data.orgs.getOrgMember(SYSTEM_CONTEXT, acme.id, bob.id)).toBeFalsy();
	});
});
