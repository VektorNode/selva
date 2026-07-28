/**
 * Audit Q5.1 + Q5.3 — `/api/compute` POST handler wiring.
 *
 * The sibling `solve-cap-and-count.test.ts` pins the *store* methods this route
 * delegates to, and deliberately skips the HTTP shell on the grounds that it
 * "needs a live compute server". That is true of a successful solve — but both
 * security gates below run and return **before** `resolveServerForOrg`, so the
 * route's own enforcement is reachable with no compute server at all. Until now
 * nothing asserted that the route actually calls those units, in the right order,
 * and maps their answers to the right status:
 *
 *   - **Q5.1** a share-token solve AT `maxSolves` must be rejected by the route
 *     itself (429), not merely by the store returning `null` to someone.
 *   - **Q5.3** the rate-limit bucket must key on `share:{linkId}` for token
 *     solves and `user:{userId}` for authenticated ones. If a share solve keyed
 *     on the *owner*, every anonymous consumer of a public link would drain the
 *     owner's budget — and one link's traffic would throttle unrelated links.
 *
 * How these avoid needing compute: the cap check (+server.ts, `tryIncrementSolveCount`
 * → 429) and the rate-limit check (`checkComputeRateLimit` → 429) both precede
 * the `resolveServerForOrg` call. A test that reaches either gate never touches
 * the network. The "admitted" cases below therefore assert only that the request
 * got *past* the gate under test — they run on to fail at compute resolution,
 * which is the expected outcome here and is asserted as `not 429`.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	seedShareLink,
	actAs,
	anon,
	call,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	computeRateLimitCount,
	resetComputeRateLimit
} from '$lib/server/computeRateLimit.server.js';
import { POST } from '../+server.js';

let tp: TestProviders | null = null;

// The limiter is module-global and the suite shares one process/fork, so a
// bucket filled here would silently throttle unrelated tests later.
beforeEach(() => resetComputeRateLimit());

afterEach(async () => {
	resetComputeRateLimit();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** A body that passes the route's up-front validation (inputs/values/definitionUrl). */
function solveBody(guid: string) {
	return { inputs: [], values: {}, definitionUrl: `local:${guid}` };
}

describe('POST /api/compute — share-link solve cap (Q5.1)', () => {
	it('rejects a share-token solve that is already AT maxSolves with 429', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link, rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: 1
		});

		// Burn the link's only solve, so the next request arrives exactly at the cap.
		expect(await tp.config.data.shareLinks.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id)).toBe(1);

		const res = await call(POST, {
			locals: anon(tp),
			url: `http://test.local/api/compute?token=${rawToken}`,
			body: solveBody(def.record.guid)
		});

		// The route — not the store — is what turns the refusal into a 429.
		expect(res.status).toBe(429);
		expect(JSON.stringify(res.json)).toMatch(/cap reached/i);

		// And the refusal did not consume another solve.
		const after = await tp.config.data.shareLinks.getById(SYSTEM_CONTEXT, link.id);
		expect(after?.solveCount).toBe(1);
	});

	it('admits a share-token solve below the cap, and burns exactly one solve', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link, rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: 5
		});

		const res = await call(POST, {
			locals: anon(tp),
			url: `http://test.local/api/compute?token=${rawToken}`,
			body: solveBody(def.record.guid)
		});

		// It got past the cap gate (it fails later, at compute resolution — there
		// is no server configured here). The point is that it was NOT capped.
		expect(res.status).not.toBe(429);

		// Exactly one solve consumed: the cap is charged once per admitted request.
		const after = await tp.config.data.shareLinks.getById(SYSTEM_CONTEXT, link.id);
		expect(after?.solveCount).toBe(1);
	});

	it('rejects a revoked link before it can solve (fail closed at the endpoint)', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link, rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: 100
		});
		await tp.config.data.shareLinks.revoke(SYSTEM_CONTEXT, link.id);

		const res = await call(POST, {
			locals: anon(tp),
			url: `http://test.local/api/compute?token=${rawToken}`,
			body: solveBody(def.record.guid)
		});

		// A revoked token is an invalid token — refused at resolution (401), well
		// before the cap gate. Never 2xx.
		expect(res.status).toBe(401);
		const after = await tp.config.data.shareLinks.getById(SYSTEM_CONTEXT, link.id);
		expect(after?.solveCount).toBe(0);
	});
});

describe('POST /api/compute — rate-limit key selection (Q5.3)', () => {
	it('keys an anonymous share solve on share:{linkId}, NOT on the link owner', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link, rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: null
		});

		await call(POST, {
			locals: anon(tp),
			url: `http://test.local/api/compute?token=${rawToken}`,
			body: solveBody(def.record.guid)
		});

		// The request consumed the SHARE bucket...
		expect(bucketCount(`share:${link.id}`)).toBe(1);
		// ...and left the owner's personal budget untouched — the property that
		// stops an anonymous crowd from throttling the author of a public link.
		expect(bucketCount(`user:${alice.id}`)).toBe(0);
	});

	it('keys an authenticated solve on user:{userId}', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);

		await call(POST, {
			locals: aliceLocals,
			body: solveBody(def.record.guid)
		});

		expect(bucketCount(`user:${alice.id}`)).toBe(1);
	});

	it('gives two different share links independent buckets', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const first = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: null
		});
		const second = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: null
		});

		await call(POST, {
			locals: anon(tp),
			url: `http://test.local/api/compute?token=${first.rawToken}`,
			body: solveBody(def.record.guid)
		});

		// Traffic on one link must not spend another link's budget, even though
		// both point at the same definition and share an owner.
		expect(bucketCount(`share:${first.link.id}`)).toBe(1);
		expect(bucketCount(`share:${second.link.id}`)).toBe(0);
	});
});

/** Requests the route charged to `key` this window. 0 when it never touched it. */
const bucketCount = (key: string): number => computeRateLimitCount(key);
