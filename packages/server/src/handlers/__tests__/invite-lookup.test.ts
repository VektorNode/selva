/**
 * `findPendingInviteInOrg` is the org-ownership check for invite-by-id routes.
 *
 * **Both** revoke and resend depend on it, which is why this lives beside the
 * helper rather than under either route: neither store scopes `revoke()` by
 * acting org, so this scan is the only thing standing between a permitted admin
 * and an invite belonging to someone else.
 *
 * `requireActingOrg` does not cover this. That guard compares the URL org to the
 * acting org — it stops a caller naming a foreign org in the path, and the
 * route tests exercise that. It says nothing about an id from a foreign org
 * submitted against the caller's *own* org, which is the case here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT, type Invite } from '@selvajs/platform';
import { randomUUID } from 'node:crypto';
import { findPendingInviteInOrg } from '../invite-lookup.js';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, seedOrg } from '../../testing/index.js';

let tp: HandlerHarness;

afterEach(async () => {
	await tp?.cleanup();
});

/**
 * `createdAt` is passed in rather than stamped from the clock. Seeding 200+
 * invites takes well under a millisecond each, so `new Date()` gives many of
 * them the identical timestamp — the `createdAt desc` sort then falls back to
 * insertion order and the "oldest" invite lands on page one at random. That
 * made the pagination test below fail its own premise guard intermittently.
 */
async function seedInvite(
	orgId: string,
	email: string,
	invitedBy: string,
	createdAt = new Date().toISOString()
): Promise<Invite> {
	const invite: Invite = {
		id: randomUUID(),
		tokenHash: `hash-${email}`,
		email,
		orgId,
		orgRole: 'member',
		orgPermissions: [],
		platformPermissions: [],
		invitedBy,
		createdAt,
		expiresAt: new Date(Date.now() + 86_400_000).toISOString()
	};
	await tp.config.data.invites.create(SYSTEM_CONTEXT, invite);
	return invite;
}

describe('findPendingInviteInOrg', () => {
	it('finds an invite that belongs to the org', async () => {
		tp = await freshHarness();
		const { acme, alice } = await seedAcme(tp);
		const invite = await seedInvite(acme.id, 'mine@acme.test', alice.id);

		const found = await findPendingInviteInOrg(
			SYSTEM_CONTEXT,
			acme.id,
			invite.id,
			tp.config.data.invites
		);

		expect(found?.id).toBe(invite.id);
	});

	it('returns null for an id belonging to another org', async () => {
		tp = await freshHarness();
		const { acme, alice } = await seedAcme(tp);
		const other = await seedOrg(tp, { name: 'Other Co', slug: 'other-co', ownerId: alice.id });

		// The caller's own org must be non-empty. With it empty, a scan that
		// ignored the id and returned the first row would find nothing, and this
		// test would pass against a broken implementation.
		await seedInvite(acme.id, 'mine@acme.test', alice.id);
		const foreign = await seedInvite(other.id, 'theirs@other.test', alice.id);

		const found = await findPendingInviteInOrg(
			SYSTEM_CONTEXT,
			acme.id,
			foreign.id,
			tp.config.data.invites
		);

		expect(found).toBeNull();
	});

	// Seeds 206 invites through a real store, which takes ~2s idle and more when
	// the rest of the suite is competing for the disk — comfortably past vitest's
	// 5s default under load. The work is inherent: the whole point is exceeding
	// one 200-row page.
	it('finds an invite past the first page', { timeout: 30_000 }, async () => {
		tp = await freshHarness();
		const { acme, alice } = await seedAcme(tp);

		// The scan pages at 200. A single-page implementation would miss anything
		// beyond that and report a real invite as foreign — refusing a revoke the
		// admin is entitled to, and only once the org got busy enough to need it.
		//
		// The target is the OLDEST invite, not the newest. Listing defaults to
		// `createdAt desc`, so the newest sorts onto page one and a single-page
		// scan would still find it — the test would pass against exactly the
		// implementation it exists to reject. Timestamps are explicit and a
		// second apart because the clock is too coarse to order 206 writes.
		const base = Date.parse('2026-01-01T00:00:00.000Z');
		const at = (i: number) => new Date(base + i * 1000).toISOString();
		const oldest = await seedInvite(acme.id, 'oldest@acme.test', alice.id, at(0));
		for (let i = 0; i < 205; i++) {
			await seedInvite(acme.id, `bulk-${i}@acme.test`, alice.id, at(i + 1));
		}

		const firstPage = await tp.config.data.invites.listByOrg(SYSTEM_CONTEXT, acme.id, {
			limit: 200
		});
		// Guards the premise: if the target ever lands on page one, this test stops
		// testing pagination and nothing else would say so.
		expect(firstPage.items.map((i) => i.id)).not.toContain(oldest.id);
		expect(firstPage.nextCursor).toBeTruthy();

		const found = await findPendingInviteInOrg(
			SYSTEM_CONTEXT,
			acme.id,
			oldest.id,
			tp.config.data.invites
		);

		expect(found?.id).toBe(oldest.id);
	});
});
