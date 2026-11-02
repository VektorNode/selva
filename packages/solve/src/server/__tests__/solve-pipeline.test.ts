/**
 * `@selvajs/compute` is mocked so the pipeline runs without a live compute server: the scheduler
 * is a stub whose `solveDetailed` each test scripts. That isolates what is shared across
 * coalesced callers: how a solve ended, and what it carries for them to encode.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DataTree, GrasshopperClient, SolveScheduler } from '@selvajs/compute/grasshopper';

vi.mock('@selvajs/compute/core', () => {
	class MockComputeError extends Error {
		code: string;
		statusCode?: number;
		context?: Record<string, unknown>;
		constructor(
			message: string,
			code: string,
			options?: { statusCode?: number; context?: Record<string, unknown> }
		) {
			super(message);
			this.name = 'ComputeError';
			this.code = code;
			this.statusCode = options?.statusCode;
			this.context = options?.context;
		}
	}
	return {
		ComputeError: MockComputeError,
		ErrorCodes: {
			QUEUE_FULL: 'QUEUE_FULL',
			QUEUE_TIMEOUT: 'QUEUE_TIMEOUT',
			ABORTED: 'ABORTED',
			TIMEOUT_ERROR: 'TIMEOUT_ERROR',
			RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
			UNKNOWN_ERROR: 'UNKNOWN_ERROR'
		}
	};
});

import { ComputeError, type ServerTiming } from '@selvajs/compute/core';
import { runSolvePipeline, type SolvePipelineArgs } from '../solve-pipeline.js';
import type { CachedClient } from '../client-cache.js';
import { createDefinitionByteCache } from '../definition-byte-cache.js';

const computeError = (
	code: string,
	options?: { statusCode?: number; context?: Record<string, unknown> }
) =>
	new (ComputeError as unknown as new (m: string, c: string, o?: typeof options) => Error)(
		`failed: ${code}`,
		code,
		options
	);

type SolveStub = (
	def: unknown,
	tree: unknown,
	opts: { signal?: AbortSignal; onServerTiming?: (timing: ServerTiming) => void }
) => Promise<Record<string, unknown>>;

function fakeClient(
	solve: SolveStub,
	verdict: { fromCache: boolean; definitionReuploaded?: boolean } = { fromCache: false }
): CachedClient {
	const solveDetailed = async (...args: Parameters<SolveStub>) => ({
		response: await solve(...args),
		durationMs: 0,
		...verdict
	});
	return {
		client: {} as GrasshopperClient,
		scheduler: { solveDetailed } as unknown as SolveScheduler
	};
}

const throws = (err: unknown) =>
	fakeClient(async () => {
		throw err;
	});

function args(over: Partial<SolvePipelineArgs> = {}): SolvePipelineArgs {
	return {
		definitionSource: new Uint8Array([1, 2, 3]),
		inputTree: [],
		client: fakeClient(async () => ({ values: [], errors: [], warnings: [] })),
		responseMaxBytes: 10 * 1024 * 1024,
		solveDeadlineMs: 42_000,
		signal: new AbortController().signal,
		...over
	};
}

describe('runSolvePipeline — a solve that ran', () => {
	it('solves the tree it was given, with its signal', async () => {
		const controller = new AbortController();
		const tree = [{ ParamName: 'a' }] as unknown as DataTree[];
		let seen: { tree: unknown; signal?: AbortSignal } | undefined;
		await runSolvePipeline(
			args({
				inputTree: tree,
				signal: controller.signal,
				client: fakeClient(async (_d, t, opts) => {
					seen = { tree: t, signal: opts.signal };
					return {};
				})
			})
		);
		expect(seen?.tree).toBe(tree);
		expect(seen?.signal).toBe(controller.signal);
	});

	it('carries the response, cache verdict and Rhino timing for its callers', async () => {
		const response = { values: [] };
		const timing: ServerTiming = { solve: 20, raw: '' };
		const flight = await runSolvePipeline(
			args({
				client: fakeClient(
					async (_d, _t, opts) => {
						opts.onServerTiming?.(timing);
						return response;
					},
					{ fromCache: true, definitionReuploaded: false }
				)
			})
		);
		if (flight.kind !== 'solved') throw new Error(flight.kind);
		expect(flight.response).toBe(response);
		expect(flight.rhino).toBe(timing);
		expect(flight.settle).toEqual({ fromCache: true, definitionReuploaded: false });
	});

	it('keeps overlapping solves on one warm client apart', async () => {
		// Each call reports through its own callback, so a concurrent solve on the same
		// client can't leak its timing into this one's.
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const timings = [
			{ solve: 20, raw: '' },
			{ solve: 1, raw: '' }
		];
		let n = 0;
		const client = fakeClient(async (_d, _t, opts) => {
			const timing = timings[n++];
			await gate;
			opts.onServerTiming?.(timing);
			return {};
		});
		const a = runSolvePipeline(args({ client }));
		const b = runSolvePipeline(args({ client }));
		release();
		const [flightA, flightB] = await Promise.all([a, b]);
		if (flightA.kind !== 'solved' || flightB.kind !== 'solved') throw new Error('expected solved');
		expect(flightA.rhino?.solve).toBe(20);
		expect(flightB.rhino?.solve).toBe(1);
	});

	it('omits defBytes for a raw-bytes solve', async () => {
		const flight = await runSolvePipeline(args());
		if (flight.kind !== 'solved') throw new Error(flight.kind);
		expect(flight.defBytes).toBeUndefined();
	});

	it.each([
		['skipped', false, false],
		['miss', true, false],
		['hit', true, true]
	])('reads defBytes %s from a byte-cache ref', async (verdict, loaded, fromCache) => {
		const ref = createDefinitionByteCache(0).getOrLoad('v', async () => new Uint8Array());
		ref.outcome.loaded = loaded;
		ref.outcome.fromCache = fromCache;
		const flight = await runSolvePipeline(args({ definitionSource: ref }));
		if (flight.kind !== 'solved') throw new Error(flight.kind);
		expect(flight.defBytes).toBe(verdict);
	});
});

describe('runSolvePipeline — how a solve fails', () => {
	it("reads the scheduler's own deadline as a timeout, phrased from solveDeadlineMs", async () => {
		const outcome = await runSolvePipeline(args({ client: throws(computeError('TIMEOUT_ERROR')) }));
		expect(outcome.kind).toBe('timeout');
		if (outcome.kind !== 'timeout') return;
		expect(outcome.message).toContain('42s');
		expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('reads ABORTED with the signal aborted as client_abort', async () => {
		const controller = new AbortController();
		controller.abort();
		const outcome = await runSolvePipeline(
			args({ signal: controller.signal, client: throws(computeError('ABORTED')) })
		);
		expect(outcome.kind).toBe('client_abort');
	});

	it('settles a disconnect while queued as client_abort, with the signal handed over', async () => {
		const controller = new AbortController();
		let seen: AbortSignal | undefined;
		const outcome = await runSolvePipeline(
			args({
				signal: controller.signal,
				client: fakeClient(async (_d, _t, opts) => {
					seen = opts.signal;
					controller.abort();
					throw computeError('ABORTED');
				})
			})
		);
		expect(seen).toBe(controller.signal);
		expect(outcome.kind).toBe('client_abort');
	});

	it('never reads an abort nobody asked for as a deadline', async () => {
		const outcome = await runSolvePipeline(args({ client: throws(computeError('ABORTED')) }));
		expect(outcome.kind).toBe('shed');
		if (outcome.kind !== 'shed') return;
		expect(outcome.reason).toBe('interrupted');
		expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
	});

	it('classifies any other throw as compute_error carrying the original error', async () => {
		const boom = new TypeError('fetch failed');
		const outcome = await runSolvePipeline(args({ client: throws(boom) }));
		expect(outcome.kind).toBe('compute_error');
		if (outcome.kind !== 'compute_error') return;
		expect(outcome.error).toBe(boom);
	});

	it('returns too_large when compute cut the download at its byte cap', async () => {
		const outcome = await runSolvePipeline(
			args({ client: throws(computeError('RESPONSE_TOO_LARGE', { statusCode: 200 })) })
		);
		expect(outcome.kind).toBe('too_large');
	});

	it('classifies a QUEUE_FULL rejection as shed(queue_full) with a Retry-After hint', async () => {
		const outcome = await runSolvePipeline(
			args({ client: throws(computeError('QUEUE_FULL', { statusCode: 503 })) })
		);
		expect(outcome.kind).toBe('shed');
		if (outcome.kind !== 'shed') return;
		expect(outcome.reason).toBe('queue_full');
		expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
		expect(outcome.message).toBeTruthy();
	});

	it('classifies a QUEUE_TIMEOUT rejection as shed(queue_timeout)', async () => {
		const outcome = await runSolvePipeline(
			args({ client: throws(computeError('QUEUE_TIMEOUT', { statusCode: 503 })) })
		);
		expect(outcome.kind).toBe('shed');
		if (outcome.kind !== 'shed') return;
		expect(outcome.reason).toBe('queue_timeout');
	});

	it('does NOT shed a ComputeError with an unrelated code', async () => {
		const boom = computeError('UNKNOWN_ERROR', { statusCode: 500 });
		const outcome = await runSolvePipeline(args({ client: throws(boom) }));
		expect(outcome.kind).toBe('compute_error');
		if (outcome.kind !== 'compute_error') return;
		expect(outcome.error).toBe(boom);
	});
});
