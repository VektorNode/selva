/**
 * Tests for `runSolvePipeline` — the transport-agnostic solve core (K3).
 *
 * `@selvajs/compute` is mocked so the pipeline runs without a live compute
 * server: `TreeBuilder.fromInputParams` returns a marker tree and the scheduler
 * is a stub whose `solve` we script per test (resolve a response, throw an
 * AbortError, etc.). That isolates the pipeline's own behavior — outcome
 * classification, size cap, gzip, and the Server-Timing / version envelope.
 */

import { describe, it, expect, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { GrasshopperClient, InputParam, SolveScheduler } from '@selvajs/compute';

// --- Mock @selvajs/compute -------------------------------------------------
vi.mock('@selvajs/compute', () => {
	return {
		TreeBuilder: {
			fromInputParams: (params: unknown[]) => ({ __tree: true, count: params.length })
		},
		// transform-input.ts (imported by the pipeline) calls processInput; return
		// the raw shape as an InputParam so filtering/mapping runs end-to-end.
		processInput: (raw: InputParam) => raw
	};
});

import {
	runSolvePipeline,
	COMPUTE_CONTRACT_VERSION,
	COMPUTE_VERSION_HEADER,
	type SolvePipelineArgs,
	type PipelineInput,
	type CachedClient
} from '../index.js';

/**
 * A scripted solve stub. The pipeline only JSON-serializes and reads
 * `errors`/`warnings`, so tests return arbitrary fake payloads — the return is a
 * loose record rather than the full `GrasshopperComputeResponse`.
 */
type SolveStub = (
	def: string | Uint8Array,
	tree: unknown,
	opts: { signal?: AbortSignal }
) => Promise<Record<string, unknown>>;

/** A CachedClient stub whose scheduler.solve is scripted per test. */
function fakeClient(solve: SolveStub): CachedClient {
	return {
		client: {} as GrasshopperClient,
		scheduler: { solve } as unknown as SolveScheduler,
		rhinoTiming: { last: null, seq: 0 },
		solveMeta: { last: null, seq: 0 }
	};
}

function baseArgs(over: Partial<SolvePipelineArgs> = {}): SolvePipelineArgs {
	return {
		definitionSource: new Uint8Array([1, 2, 3]),
		inputs: [{ id: 'a', paramType: 'number', nickname: 'A' } as PipelineInput],
		values: { a: 5 },
		client: fakeClient(async () => ({ values: [], errors: [], warnings: [] })),
		responseMaxBytes: 10 * 1024 * 1024,
		maxSolveDurationMs: 100_000,
		acceptEncoding: '',
		signal: new AbortController().signal,
		loadStartMs: performance.now(),
		defLoadMs: 1.5,
		prepMarks: [['body', 0.2]],
		...over
	};
}

describe('runSolvePipeline — success', () => {
	it('returns an ok envelope with a JSON body and the version header', async () => {
		const result = { values: [{ id: 'out' }], errors: [], warnings: ['w'] };
		const outcome = await runSolvePipeline(baseArgs({ client: fakeClient(async () => result) }));
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		expect(outcome.errorCount).toBe(0);
		expect(outcome.warningCount).toBe(1);
		expect(outcome.envelope.encoding).toBeUndefined();
		expect(JSON.parse(outcome.envelope.body as string)).toEqual(result);
		expect(outcome.envelope.headers[COMPUTE_VERSION_HEADER]).toBe(String(COMPUTE_CONTRACT_VERSION));
		expect(outcome.envelope.headers['Content-Type']).toBe('application/json');
		expect(outcome.envelope.headers['Content-Length']).toBe(
			String(Buffer.byteLength(outcome.envelope.body as string))
		);
	});

	it('only sends inputs with a paramType to the tree builder', async () => {
		let seenTree: unknown;
		const outcome = await runSolvePipeline(
			baseArgs({
				inputs: [
					{ id: 'a', paramType: 'number', nickname: 'A' } as PipelineInput,
					{ id: 'b', nickname: 'B' } as PipelineInput // no paramType → filtered out
				],
				client: fakeClient(async (_def, tree) => {
					seenTree = tree;
					return { errors: [], warnings: [] };
				})
			})
		);
		expect(outcome.kind).toBe('ok');
		expect(seenTree).toEqual({ __tree: true, count: 1 });
	});

	it('forwards the abort signal to the scheduler', async () => {
		const controller = new AbortController();
		let seenSignal: AbortSignal | undefined;
		await runSolvePipeline(
			baseArgs({
				signal: controller.signal,
				client: fakeClient(async (_d, _t, opts) => {
					seenSignal = opts.signal;
					return { errors: [], warnings: [] };
				})
			})
		);
		expect(seenSignal).toBe(controller.signal);
	});
});

describe('runSolvePipeline — gzip', () => {
	it('compresses when Accept-Encoding allows and the body is over 1 KB', async () => {
		// A payload comfortably over the 1 KB gzip threshold.
		const big = { values: Array.from({ length: 500 }, (_, i) => ({ i, s: 'xxxxxxxxxx' })) };
		const outcome = await runSolvePipeline(
			baseArgs({ acceptEncoding: 'gzip, br', client: fakeClient(async () => big) })
		);
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		expect(outcome.envelope.encoding).toBe('gzip');
		expect(outcome.envelope.headers['Content-Encoding']).toBe('gzip');
		expect(outcome.envelope.headers['Vary']).toBe('Accept-Encoding');
		// The gzip body round-trips back to the original JSON.
		const inflated = gunzipSync(Buffer.from(outcome.envelope.body as Uint8Array)).toString();
		expect(JSON.parse(inflated)).toEqual(big);
		expect(outcome.envelope.metrics.compressedBytes).toBeGreaterThan(0);
	});

	it('does NOT compress when Accept-Encoding lacks gzip', async () => {
		const big = { values: Array.from({ length: 500 }, (_, i) => ({ i, s: 'xxxxxxxxxx' })) };
		const outcome = await runSolvePipeline(
			baseArgs({ acceptEncoding: 'br', client: fakeClient(async () => big) })
		);
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		expect(outcome.envelope.encoding).toBeUndefined();
		expect(outcome.envelope.headers['Content-Encoding']).toBeUndefined();
		expect(outcome.envelope.metrics.compressedBytes).toBeNull();
	});

	it('does NOT compress a tiny body even with gzip advertised', async () => {
		const outcome = await runSolvePipeline(
			baseArgs({ acceptEncoding: 'gzip', client: fakeClient(async () => ({ ok: 1 })) })
		);
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		expect(outcome.envelope.encoding).toBeUndefined();
	});
});

describe('runSolvePipeline — failure outcomes', () => {
	it('classifies the scheduler deadline (AbortError, signal NOT aborted) as timeout', async () => {
		const outcome = await runSolvePipeline(
			baseArgs({
				maxSolveDurationMs: 42_000,
				client: fakeClient(async () => {
					const e = new Error('aborted');
					e.name = 'AbortError';
					throw e;
				})
			})
		);
		expect(outcome.kind).toBe('timeout');
		if (outcome.kind !== 'timeout') return;
		expect(outcome.message).toContain('42s');
		expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('classifies AbortError with the request signal aborted as client_abort', async () => {
		const controller = new AbortController();
		controller.abort();
		const outcome = await runSolvePipeline(
			baseArgs({
				signal: controller.signal,
				client: fakeClient(async () => {
					const e = new Error('aborted');
					e.name = 'AbortError';
					throw e;
				})
			})
		);
		expect(outcome.kind).toBe('client_abort');
	});

	it('classifies any other throw as compute_error carrying the original error', async () => {
		const boom = new TypeError('fetch failed');
		const outcome = await runSolvePipeline(
			baseArgs({
				client: fakeClient(async () => {
					throw boom;
				})
			})
		);
		expect(outcome.kind).toBe('compute_error');
		if (outcome.kind !== 'compute_error') return;
		expect(outcome.error).toBe(boom);
	});

	it('returns too_large when the serialized result exceeds responseMaxBytes', async () => {
		const outcome = await runSolvePipeline(
			baseArgs({
				responseMaxBytes: 10, // tiny cap
				client: fakeClient(async () => ({ values: 'a bigger than ten bytes payload' }))
			})
		);
		expect(outcome.kind).toBe('too_large');
	});
});

describe('runSolvePipeline — Server-Timing', () => {
	it('emits the core phases and echoes prep marks as p_*', async () => {
		const outcome = await runSolvePipeline(
			baseArgs({
				defLoadMs: 12.3,
				prepMarks: [
					['body', 0.5],
					['client', 3.1]
				],
				client: fakeClient(async () => ({ errors: [], warnings: [] }))
			})
		);
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		const st = outcome.envelope.headers['Server-Timing'];
		expect(st).toContain('load;dur=12.3');
		expect(st).toContain('tree;dur=');
		expect(st).toContain('solve;dur=');
		expect(st).toContain('serialize;dur=');
		expect(st).toContain('total;dur=');
		expect(st).toContain('p_body;dur=0.5');
		expect(st).toContain('p_client;dur=3.1');
	});

	it('splits solve into rhino_* + compute_link when the client reported server timing', async () => {
		// The real callbacks fire DURING the solve: onServerTiming per compute
		// call, onSettle per settle — each bumps its seq. Mimic both so the
		// pipeline's attribution guard (exactly one write since the snapshot,
		// settle not fromCache) sees this request's own telemetry.
		const client: CachedClient = fakeClient(async () => {
			client.rhinoTiming.seq += 1;
			client.rhinoTiming.last = { decode: 5, solve: 20, encode: 3 };
			client.solveMeta.seq += 1;
			client.solveMeta.last = { fromCache: false, definitionReuploaded: false };
			return { errors: [], warnings: [] };
		});
		const outcome = await runSolvePipeline(baseArgs({ client }));
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		const st = outcome.envelope.headers['Server-Timing'];
		expect(st).toContain('rhino_decode;dur=5.0');
		expect(st).toContain('rhino_solve;dur=20.0');
		expect(st).toContain('rhino_encode;dur=3.0');
		expect(st).toContain('compute_link;dur=');
	});

	it('surfaces selva_cache + def_reupload verdicts as 0/1 flags', async () => {
		const client: CachedClient = fakeClient(async () => {
			client.solveMeta.seq += 1;
			client.solveMeta.last = { fromCache: true, definitionReuploaded: false };
			return { errors: [], warnings: [] };
		});
		const outcome = await runSolvePipeline(baseArgs({ client }));
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		const st = outcome.envelope.headers['Server-Timing'];
		expect(st).toContain('selva_cache;dur=1');
		expect(st).toContain('def_reupload;dur=0');
	});

	it('does not attribute stale telemetry a previous request left on the warm client', async () => {
		// The holders are shared per-server. Data written before this solve's
		// snapshot (seq unchanged during the solve) must not leak into this
		// request's Server-Timing.
		const client = fakeClient(async () => ({ errors: [], warnings: [] }));
		client.rhinoTiming = { last: { decode: 99, solve: 99, encode: 99 }, seq: 3 };
		client.solveMeta = { last: { fromCache: true }, seq: 5 };
		const outcome = await runSolvePipeline(baseArgs({ client }));
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		expect(outcome.envelope.headers['Server-Timing']).not.toContain('rhino_decode');
		expect(outcome.envelope.headers['Server-Timing']).not.toContain('selva_cache');
	});

	it('drops telemetry when a concurrent request also settled in the window (audit B6)', async () => {
		// With maxConcurrentSolves > 1 two solves can interleave. More than one
		// settle since this request's snapshot makes the shared slots ambiguous —
		// the pipeline must omit the segments rather than report another
		// request's cache verdict / rhino timing as ours.
		const client: CachedClient = fakeClient(async () => {
			// Our own solve's callbacks…
			client.rhinoTiming.seq += 1;
			client.rhinoTiming.last = { decode: 5, solve: 20, encode: 3 };
			client.solveMeta.seq += 1;
			client.solveMeta.last = { fromCache: false, definitionReuploaded: false };
			// …then a concurrent request settles before we read.
			client.rhinoTiming.seq += 1;
			client.rhinoTiming.last = { decode: 1, solve: 1, encode: 1 };
			client.solveMeta.seq += 1;
			client.solveMeta.last = { fromCache: true };
			return { errors: [], warnings: [] };
		});
		const outcome = await runSolvePipeline(baseArgs({ client }));
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		const st = outcome.envelope.headers['Server-Timing'];
		expect(st).not.toContain('selva_cache');
		expect(st).not.toContain('rhino_decode');
	});

	it('never attributes rhino timing to a Selva-cache hit (no compute call of ours)', async () => {
		// Our request was served from the in-process cache while a concurrent
		// request's compute call produced the only rhino timing in the window.
		const client: CachedClient = fakeClient(async () => {
			client.rhinoTiming.seq += 1; // the OTHER request's compute call
			client.rhinoTiming.last = { decode: 7, solve: 70, encode: 7 };
			client.solveMeta.seq += 1; // our own settle — a cache hit
			client.solveMeta.last = { fromCache: true };
			return { errors: [], warnings: [] };
		});
		const outcome = await runSolvePipeline(baseArgs({ client }));
		expect(outcome.kind).toBe('ok');
		if (outcome.kind !== 'ok') return;
		const st = outcome.envelope.headers['Server-Timing'];
		expect(st).toContain('selva_cache;dur=1');
		expect(st).not.toContain('rhino_decode');
	});
});
