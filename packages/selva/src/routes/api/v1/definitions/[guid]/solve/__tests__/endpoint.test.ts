/**
 * `POST /api/v1/definitions/{guid}/solve` — the definition-addressed solve.
 *
 * It shares its whole core with `/api/v1/compute`, so what needs asserting here
 * is the *difference*: this route takes the guid from the path, requires a real
 * logged-in context, and has NO share-token branch. A share token that solved
 * here would bypass the per-definition access rules the core skips for share
 * access — the token grants one definition on one channel, and nothing on this
 * path validates it.
 *
 * These tests never reach a compute server: every assertion lands on a gate that
 * runs before `resolveServerForOrg`. The "admitted" cases assert only that a
 * request got *past* the gate under test.
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
import { resetComputeRateLimit } from '$lib/server/computeRateLimit.server.js';
import { resetIdempotencyStore } from '$lib/server/computeIdempotency.server.js';
import { POST } from '../+server.js';

let tp: TestProviders | null = null;

beforeEach(() => {
	resetComputeRateLimit();
	resetIdempotencyStore();
});

afterEach(async () => {
	resetComputeRateLimit();
	resetIdempotencyStore();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('POST /api/v1/definitions/{guid}/solve — access', () => {
	it('rejects an anonymous caller with 401', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(POST, {
			locals: anon(tp),
			params: { guid: def.record.guid },
			body: { inputs: [], values: {} }
		});

		expect(res.status).toBe(401);
	});

	it('ignores a share token — the token grants nothing on this path', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { rawToken } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: null
		});

		// The exact request that /api/v1/compute would admit anonymously.
		const res = await call(POST, {
			locals: anon(tp),
			params: { guid: def.record.guid },
			url: `http://test.local/api/v1/definitions/${def.record.guid}/solve?token=${rawToken}`,
			body: { inputs: [], values: {} }
		});

		expect(res.status).toBe(401);
	});

	it('404s a definition the caller cannot see', async () => {
		tp = await freshProviders();
		const { bob, alicesPrivate, alice } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(POST, {
			locals: await actAs(tp, bob.id),
			params: { guid: def.record.guid },
			body: { inputs: [], values: {} }
		});

		// Never 403 — that would confirm the guid exists to a caller outside it.
		expect(res.status).toBe(404);
	});

	it('admits the definition owner past the access gate', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(POST, {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { inputs: [], values: {} }
		});

		// Fails later at compute resolution (no server configured) — the point is
		// that it was neither 401 nor 404.
		expect(res.status).not.toBe(401);
		expect(res.status).not.toBe(404);
	});
});

describe('POST /api/v1/definitions/{guid}/solve — body', () => {
	it('rejects a definitionUrl naming a different definition', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(POST, {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { inputs: [], values: {}, definitionUrl: 'local:some-other-guid' }
		});

		expect(res.status).toBe(400);
		expect(JSON.stringify(res.json)).toMatch(/definitionUrl/);
	});

	it('accepts a definitionUrl that agrees with the path', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(POST, {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { inputs: [], values: {}, definitionUrl: `local:${def.record.guid}` }
		});

		expect(res.status).not.toBe(400);
	});

	it('rejects an invalid channel', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(POST, {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { inputs: [], values: {}, channel: 'preview' }
		});

		expect(res.status).toBe(400);
	});
});
