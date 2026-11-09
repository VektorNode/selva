/**
 * What a solve request leaves behind besides its response: one solve-metric row per attempt,
 * the definition's solve count on success, and the caller's compute bucket. The engine is
 * stubbed, so each outcome kind can be driven without a compute server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const solve = vi.hoisted(() => vi.fn());

vi.mock('#lib/server/compute/engine.server.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	engine: {
		solve,
		definitionRef: (key: string) => ({
			key,
			load: async () => new Uint8Array(),
			outcome: { loaded: false, fromCache: false }
		}),
		toWebResponse: (outcome: { kind: string; error?: unknown }) => {
			if (outcome.kind === 'compute_error') throw outcome.error;
			return new Response('{}', { status: outcome.kind === 'ok' ? 200 : 504 });
		}
	}
}));
vi.mock('@selvajs/server/compute', async (importOriginal) => ({
	...(await importOriginal<object>()),
	createServerResolver: () => ({
		resolve: async () => ({ id: 'server', serverUrl: 'http://compute.test' }),
		forget: () => {}
	})
}));

import { SYSTEM_CONTEXT, type ISolveMetricSink, type SolveMetric } from '@selvajs/platform';
import {
	actAs,
	anon,
	call,
	freshProviders,
	seedAcme,
	seedDefinition,
	seedShareLink,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import {
	checkComputeRateLimit,
	resetComputeRateLimit
} from '#lib/server/computeRateLimit.server.js';
import { RATE_LIMIT_MAX_REQUESTS } from '#lib/server/computeLimits.js';
import { computeSessionId } from '#lib/server/compute/sessionId.server.js';
import { POST } from '../+server.js';

let tp: TestProviders | null = null;
let metrics: SolveMetric[] = [];

beforeEach(() => {
	resetComputeRateLimit();
	metrics = [];
	solve.mockReset();
});

afterEach(async () => {
	resetComputeRateLimit();
	await tp?.cleanup();
	tp = null;
});

async function setup() {
	tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
	const sink: ISolveMetricSink = {
		record: async (_ctx, metric) => {
			metrics.push(metric);
		}
	};
	(tp.config.data as { solveMetrics?: ISolveMetricSink }).solveMetrics = sink;
	const cast = await seedAcme(tp);
	const def = await seedDefinition(tp, {
		projectId: cast.alicesPrivate.id,
		ownerId: cast.alice.id
	});
	return { ...cast, def, guid: def.record.guid };
}

const body = (guid: string) => ({ values: {}, definitionUrl: `local:${guid}` });

const solveCount = async (guid: string) =>
	(await tp!.config.data.definitions.get(SYSTEM_CONTEXT, guid))?.solveCount;

describe('POST /api/v1/compute — solve metric', () => {
	it('records a successful solve with its attribution and counts, and bumps its solve count', async () => {
		const { alice, acme, def, guid } = await setup();
		solve.mockResolvedValue({
			kind: 'ok',
			envelope: {},
			solveMs: 42,
			errorCount: 2,
			warningCount: 1
		});

		const res = await call(POST, { locals: await actAs(tp!, alice.id), body: body(guid) });

		expect(res.status).toBe(200);
		expect(metrics).toEqual([
			{
				definitionUrl: `local:${guid}`,
				definitionId: guid,
				versionId: def.version.id,
				channel: 'live',
				orgId: acme.id,
				durationMs: 42,
				ok: true,
				failureKind: 'ok',
				errorCount: 2,
				warningCount: 1
			}
		]);
		// The increment is fire-and-forget, so it may land after the response.
		await vi.waitFor(async () => expect(await solveCount(guid)).toBe(1));
	});

	it('records a failed solve as not ok, with its failure kind', async () => {
		const { alice, acme, guid } = await setup();
		solve.mockResolvedValue({ kind: 'timeout', durationMs: 900, message: 'deadline' });

		const res = await call(POST, { locals: await actAs(tp!, alice.id), body: body(guid) });

		expect(res.status).toBe(504);
		expect(metrics).toHaveLength(1);
		expect(metrics[0]).toMatchObject({
			definitionId: guid,
			orgId: acme.id,
			durationMs: 900,
			ok: false,
			failureKind: 'timeout'
		});
	});

	it('records a compute error before the route maps it', async () => {
		const { alice, guid } = await setup();
		solve.mockResolvedValue({ kind: 'compute_error', durationMs: 5, error: new Error('boom') });

		const res = await call(POST, { locals: await actAs(tp!, alice.id), body: body(guid) });

		expect(res.status).toBe(500);
		expect(metrics).toEqual([
			expect.objectContaining({ ok: false, failureKind: 'compute_error', durationMs: 5 })
		]);
	});

	it('records a share-cap refusal as share_cap, without solving', async () => {
		const { alice, acme, guid } = await setup();
		const { link, rawToken } = await seedShareLink(tp!, {
			definitionId: guid,
			createdBy: alice.id,
			maxSolves: 1
		});
		await tp!.config.data.shareLinks.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id);

		const res = await call(POST, {
			locals: anon(tp!),
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
			body: body(guid)
		});

		expect(res.status).toBe(429);
		expect(solve).not.toHaveBeenCalled();
		expect(metrics).toEqual([
			expect.objectContaining({
				definitionId: guid,
				orgId: acme.id,
				ok: false,
				failureKind: 'share_cap'
			})
		]);
	});
});

describe('POST /api/v1/compute — solve counts', () => {
	it('leaves the solve count alone when the solve fails', async () => {
		const { alice, guid } = await setup();
		solve.mockResolvedValue({ kind: 'timeout', durationMs: 1, message: 'deadline' });

		await call(POST, { locals: await actAs(tp!, alice.id), body: body(guid) });

		expect(await solveCount(guid)).toBe(0);
	});

	it('charges a share-link solve to both the link and the definition', async () => {
		const { alice, guid } = await setup();
		const { link, rawToken } = await seedShareLink(tp!, {
			definitionId: guid,
			createdBy: alice.id,
			maxSolves: 5
		});
		solve.mockResolvedValue({
			kind: 'ok',
			envelope: {},
			solveMs: 1,
			errorCount: 0,
			warningCount: 0
		});

		const res = await call(POST, {
			locals: anon(tp!),
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
			body: body(guid)
		});

		expect(res.status).toBe(200);
		expect((await tp!.config.data.shareLinks.getById(SYSTEM_CONTEXT, link.id))?.solveCount).toBe(1);
		await vi.waitFor(async () => expect(await solveCount(guid)).toBe(1));
	});
});

describe('POST /api/v1/compute — compute session id', () => {
	// Not `ok`: its fire-and-forget solve-count write would race the teardown.
	const outcome = { kind: 'timeout', durationMs: 1, message: 'deadline' };
	const sentSessionId = () => (solve.mock.calls[0][0] as { sessionId?: string }).sessionId;

	beforeEach(() => {
		vi.stubEnv('SELVA_HMAC_KEY', 'test-secret-that-is-at-least-32-chars-long');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("routes a signed-in user's solve on that user's session for the definition", async () => {
		const { alice, guid } = await setup();
		solve.mockResolvedValue(outcome);

		await call(POST, { locals: await actAs(tp!, alice.id), body: body(guid) });

		expect(sentSessionId()).toMatch(/^[0-9a-f]{32}$/);
		expect(sentSessionId()).toBe(computeSessionId(alice.id, guid));
	});

	it('sends none for a share-link solve, so visitors cannot share one session', async () => {
		const { alice, guid } = await setup();
		const { rawToken } = await seedShareLink(tp!, { definitionId: guid, createdBy: alice.id });
		solve.mockResolvedValue(outcome);

		await call(POST, {
			locals: anon(tp!),
			url: `http://test.local/api/v1/compute?token=${rawToken}`,
			body: body(guid)
		});

		expect(solve).toHaveBeenCalledOnce();
		expect(sentSessionId()).toBeUndefined();
	});
});

describe('POST /api/v1/compute — compute rate limit', () => {
	it("refuses with 429 once the caller's bucket is full, and records it", async () => {
		const { alice, guid } = await setup();
		for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkComputeRateLimit(`user:${alice.id}`);

		const res = await call(POST, { locals: await actAs(tp!, alice.id), body: body(guid) });

		expect(res.status).toBe(429);
		expect((res.json as { code?: string }).code).toBe('RATE_LIMITED');
		expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(solve).not.toHaveBeenCalled();
		// Refused before the definition is read, so nothing is attributed yet.
		expect(metrics).toEqual([
			expect.objectContaining({
				definitionId: null,
				orgId: null,
				ok: false,
				failureKind: 'rate_limited'
			})
		]);
	});
});
