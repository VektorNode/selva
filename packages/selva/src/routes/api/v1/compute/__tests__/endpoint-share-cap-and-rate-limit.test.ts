/**
 * `POST /api/v1/compute` enforces two gates before it solves, and these tests hit
 * the route, not the stores behind it:
 *
 *   - a share-token solve at the link's `maxSolves` is refused with 429 and does
 *     not spend another solve;
 *   - the compute bucket is `share:{linkId}` for a token solve and
 *     `user:{userId}` for a signed-in one. Keyed on the link's owner, every
 *     anonymous visitor of a public link would drain the owner's budget, and
 *     one link's traffic would throttle the owner's other links.
 *
 * No compute server is configured, so an admitted request stops at server
 * resolution with 503.
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
} from '#lib/server/__tests__/fixtures.js';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import type { UISchema } from '@selvajs/schemas';
import {
	computeRateLimitCount,
	resetComputeRateLimit
} from '#lib/server/computeRateLimit.server.js';
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

describe('POST /api/v1/compute — share-link solve cap', () => {
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
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
			body: solveBody(def.record.guid)
		});

		// The route — not the store — is what turns the refusal into a 429.
		expect(res.status).toBe(429);
		expect(JSON.stringify(res.json)).toMatch(/cap reached/i);
		expect((res.json as { code?: string }).code).toBe('RATE_LIMITED');

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
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
			body: solveBody(def.record.guid)
		});

		// Past the cap gate, it stops at compute resolution: no server is configured.
		expect(res.status).toBe(503);

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
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
			body: solveBody(def.record.guid)
		});

		// A revoked token is an invalid token — refused at resolution (401), well
		// before the cap gate. Never 2xx.
		expect(res.status).toBe(401);
		const after = await tp.config.data.shareLinks.getById(SYSTEM_CONTEXT, link.id);
		expect(after?.solveCount).toBe(0);
	});

	it('refuses a value posted for a server-sourced input without spending a solve', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const aliceLocals = await actAs(tp, alice.id);
		await tp.config.data.definitions.setVersionSchema(aliceLocals.ctx, def.version.id, {
			name: 'Wall',
			inputs: [{ id: 'job', nickname: 'Job', paramType: 'Text', default: 'j1' }],
			outputs: [],
			layout: {
				type: 'flat',
				groups: [
					{
						items: [
							{ type: 'input', widgetType: 'text', paramId: 'job', source: { kind: 'server' } }
						]
					}
				]
			}
		} as unknown as UISchema);
		const { link, rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: 5
		});

		const res = await call(POST, {
			locals: anon(tp),
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
			body: { ...solveBody(def.record.guid), values: { job: 'FORGED' } }
		});

		expect(res.status).toBe(400);
		const after = await tp.config.data.shareLinks.getById(SYSTEM_CONTEXT, link.id);
		expect(after?.solveCount).toBe(0);
	});
});

describe('POST /api/v1/compute — rate-limit key selection', () => {
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
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
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
			url: `http://test.local/api/v1/compute?token=${first.rawToken}`,
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
