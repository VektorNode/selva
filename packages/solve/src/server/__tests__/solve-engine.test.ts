/**
 * Tests for `SolveEngine` — the facade composing the client cache, byte cache,
 * single-flight coalescer, and pipeline. `@selvajs/compute` is mocked the same
 * way `solve-pipeline.test.ts` and `client-cache.test.ts` mock it, so these run
 * without a live compute server and without a real Rhino.Compute handshake.
 */

import { describe, it, expect, vi } from 'vitest';
import type { InputParam } from '@selvajs/compute';

type Recorded = Record<string, unknown>;

const createdConfigs: Recorded[] = [];
let scriptedSolve: (
	def: unknown,
	tree: unknown,
	opts: { signal?: AbortSignal }
) => Promise<Record<string, unknown>> = async () => ({ values: [], errors: [], warnings: [] });

vi.mock('@selvajs/compute', () => {
	class GrasshopperClient {
		static async create(config: Recorded) {
			createdConfigs.push(config);
			return new GrasshopperClient();
		}
		serverStats = { getActiveChildren: async () => null };
		createScheduler(options: Recorded) {
			return {
				maxConcurrent: options.maxConcurrent as number,
				solve: (def: unknown, tree: unknown, opts: { signal?: AbortSignal }) =>
					scriptedSolve(def, tree, opts),
				cacheStats: () => ({ entries: 0, bytes: 0, hits: 0, misses: 0, evictions: 0 }),
				setMaxConcurrent() {},
				dispose() {}
			};
		}
	}
	class RhinoComputeError extends Error {
		code: string;
		constructor(message: string, code: string) {
			super(message);
			this.code = code;
		}
	}
	return {
		GrasshopperClient,
		enableDebugLogging: vi.fn(),
		TreeBuilder: {
			fromInputParams: (params: unknown[]) => ({ __tree: true, count: params.length })
		},
		processInput: (raw: InputParam) => raw,
		stableStringify: (value: unknown) => JSON.stringify(value),
		RhinoComputeError,
		ErrorCodes: { QUEUE_FULL: 'QUEUE_FULL', QUEUE_TIMEOUT: 'QUEUE_TIMEOUT' },
		isDefinitionRef: (d: unknown) =>
			typeof d === 'object' &&
			d !== null &&
			!(d instanceof Uint8Array) &&
			typeof (d as Recorded).key === 'string' &&
			typeof (d as Recorded).load === 'function'
	};
});

import { SolveEngine, type SolveEngineLimits } from '../solve-engine.js';
import type { PipelineInput } from '../solve-pipeline.js';

/** Flush microtasks until `check()` is truthy or `attempts` is exhausted — `getClient`'s async
 *  chain (client build + concurrency probe) hops several ticks before `scriptedSolve` runs. */
async function waitUntil(check: () => boolean, attempts = 20): Promise<void> {
	for (let i = 0; i < attempts && !check(); i++) {
		await Promise.resolve();
	}
}

function baseLimits(over: Partial<SolveEngineLimits> = {}): SolveEngineLimits {
	return {
		maxSolveDurationMs: 30_000,
		computeResponseMaxBytes: 10 * 1024 * 1024,
		computeReuseDefinitionCache: true,
		computeServerCachesolve: true,
		computeCacheErroredSolves: false,
		computeMaxQueueDepth: 0,
		computeQueueWaitMs: 0,
		computeDefinitionCacheBytes: 10 * 1024 * 1024,
		computeSolveCacheBytes: 10 * 1024 * 1024,
		...over
	};
}

const server = { id: 'srv-1', serverUrl: 'https://compute.example' };
const inputs: PipelineInput[] = [{ id: 'a', paramType: 'number', nickname: 'A' } as PipelineInput];

describe('SolveEngine.solve — definitionSource variants', () => {
	it('raw bytes without definitionKey throws', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		await expect(
			engine.solve({
				server,
				definitionSource: new Uint8Array([1, 2, 3]),
				inputs,
				values: { a: 1 },
				signal: new AbortController().signal
			})
		).rejects.toThrow('definitionKey is required');
	});

	it('raw bytes with definitionKey solves and coalesces on that key', async () => {
		let runs = 0;
		scriptedSolve = async () => {
			runs += 1;
			return { values: [], errors: [], warnings: [] };
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const args = {
			server,
			definitionSource: new Uint8Array([1, 2, 3]),
			definitionKey: 'remote:https://example.com/def.gh',
			inputs,
			values: { a: 1 },
			signal: new AbortController().signal
		};
		const [a, b] = await Promise.all([engine.solve(args), engine.solve(args)]);
		expect(a.kind).toBe('ok');
		expect(b.kind).toBe('ok');
		expect(runs).toBe(1);
	});

	it('{versionId, load} sugar builds a byte-cache ref and threads its outcome into the pipeline call, without re-wrapping on a repeat solve', async () => {
		// The real SolveScheduler calls definitionSource.load() itself when an
		// upload is unavoidable; the mocked scheduler doesn't simulate that, so
		// this test drives the ref directly to prove `solve()` reuses the SAME
		// underlying byte-cache entry across two calls rather than reading the
		// loader twice.
		scriptedSolve = async (def) => {
			await (def as { load: () => Promise<Uint8Array> }).load();
			return { values: [], errors: [], warnings: [] };
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const load = vi.fn(async () => new Uint8Array([9, 9, 9]));

		const outcome = await engine.solve({
			server,
			definitionSource: { versionId: 'v-1', load },
			inputs,
			values: {},
			signal: new AbortController().signal
		});
		expect(outcome.kind).toBe('ok');
		expect(load).toHaveBeenCalledTimes(1);

		// A second solve for the same versionId hits the warm byte-cache entry.
		const outcome2 = await engine.solve({
			server,
			definitionSource: { versionId: 'v-1', load },
			inputs,
			values: {},
			signal: new AbortController().signal
		});
		expect(outcome2.kind).toBe('ok');
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('a pre-built ByteCacheRef from engine.definitionRef() is used directly, not double-wrapped', async () => {
		scriptedSolve = async (def) => {
			await (def as { load: () => Promise<Uint8Array> }).load();
			return { values: [], errors: [], warnings: [] };
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const load = vi.fn(async () => new Uint8Array([1]));
		const ref = engine.definitionRef('v-2', load);
		await ref.load(); // simulate the caller (e.g. schema backfill) materializing bytes first
		expect(load).toHaveBeenCalledTimes(1);

		const outcome = await engine.solve({
			server,
			definitionSource: ref,
			inputs,
			values: {},
			signal: new AbortController().signal
		});
		expect(outcome.kind).toBe('ok');
		// Still only the one load — solve() reused the ref's own cached bytes, no second getOrLoad.
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('a plain external DefinitionRef (no .outcome) passes through with no byteRefOutcome threading', async () => {
		scriptedSolve = async () => ({ values: [], errors: [], warnings: [] });
		const engine = new SolveEngine({ limits: baseLimits() });
		const externalRef = { key: 'ext-1', load: async () => new Uint8Array([2]) };
		const outcome = await engine.solve({
			server,
			definitionSource: externalRef,
			inputs,
			values: {},
			signal: new AbortController().signal
		});
		expect(outcome.kind).toBe('ok');
	});
});

describe('SolveEngine.solve — coalescing and abort', () => {
	it('two concurrent identical solves run the pipeline once', async () => {
		let runs = 0;
		let release!: (v: Record<string, unknown>) => void;
		const gate = new Promise<Record<string, unknown>>((r) => (release = r));
		scriptedSolve = () => {
			runs += 1;
			return gate;
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const args = {
			server,
			definitionSource: new Uint8Array([1]),
			definitionKey: 'k',
			inputs,
			values: {},
			signal: new AbortController().signal
		};
		const p1 = engine.solve(args);
		const p2 = engine.solve(args);
		release({ values: [], errors: [], warnings: [] });
		const [a, b] = await Promise.all([p1, p2]);
		expect(runs).toBe(1);
		expect(a.kind).toBe('ok');
		expect(b.kind).toBe('ok');
	});

	it('a solo caller aborting propagates to the pipeline signal', async () => {
		let sawSignal: AbortSignal | undefined;
		scriptedSolve = (_def, _tree, opts) => {
			sawSignal = opts.signal;
			return new Promise(() => {}); // never resolves
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const controller = new AbortController();
		void engine.solve({
			server,
			definitionSource: new Uint8Array([1]),
			definitionKey: 'solo',
			inputs,
			values: {},
			signal: controller.signal
		});
		await waitUntil(() => sawSignal !== undefined);
		controller.abort();
		await Promise.resolve();
		expect(sawSignal?.aborted).toBe(true);
	});

	it('a joined (shared) flight is not aborted by one waiter disconnecting', async () => {
		let sawSignal: AbortSignal | undefined;
		scriptedSolve = (_def, _tree, opts) => {
			sawSignal = opts.signal;
			return new Promise(() => {});
		};
		let joined = false;
		const engine = new SolveEngine({
			limits: baseLimits(),
			onSolveCoalesced: () => (joined = true)
		});
		const owner = new AbortController();
		const joiner = new AbortController();
		const args = (signal: AbortSignal) => ({
			server,
			definitionSource: new Uint8Array([1]),
			definitionKey: 'shared',
			inputs,
			values: {},
			signal
		});
		void engine.solve(args(owner.signal));
		await waitUntil(() => sawSignal !== undefined); // owner's pipeline call is now in flight
		void engine.solve(args(joiner.signal));
		await waitUntil(() => joined); // joiner has attached to the owner's flight
		owner.abort();
		await Promise.resolve();
		expect(sawSignal?.aborted).toBe(false);
	});
});

describe('SolveEngine.toResponse / toWebResponse', () => {
	function engine() {
		return new SolveEngine({ limits: baseLimits() });
	}

	it('ok -> 200 with envelope body/headers', () => {
		const r = engine().toResponse({
			kind: 'ok',
			envelope: {
				body: '{}',
				headers: { 'Content-Type': 'application/json' },
				result: {} as never,
				metrics: {} as never
			},
			solveMs: 1,
			errorCount: 0,
			warningCount: 0
		});
		expect(r.status).toBe(200);
		expect(r.body).toBe('{}');
	});

	it('timeout -> 504', () => {
		const r = engine().toResponse({ kind: 'timeout', durationMs: 1, message: 'slow' });
		expect(r.status).toBe(504);
	});

	it('client_abort -> 499', () => {
		const r = engine().toResponse({ kind: 'client_abort', durationMs: 1 });
		expect(r.status).toBe(499);
	});

	it('too_large -> 413', () => {
		const r = engine().toResponse({ kind: 'too_large' });
		expect(r.status).toBe(413);
	});

	it('shed -> 503 with Retry-After header', () => {
		const r = engine().toResponse({
			kind: 'shed',
			durationMs: 1,
			reason: 'queue_full',
			retryAfterSeconds: 3,
			message: 'busy'
		});
		expect(r.status).toBe(503);
		expect(r.headers['Retry-After']).toBe('3');
	});

	it('compute_error always throws, even with onError supplied', () => {
		const err = new Error('boom');
		expect(() =>
			engine().toResponse(
				{ kind: 'compute_error', durationMs: 1, error: err },
				{
					onError: () => {
						throw new Error('should not be reached via onError');
					}
				}
			)
		).toThrow('boom');
	});

	it('onError escape hatch is called for non-ok, non-compute_error outcomes', () => {
		const seen: [number, { message: string; retryAfter?: number }][] = [];
		expect(() =>
			engine().toResponse(
				{ kind: 'too_large' },
				{
					onError: (status, body): never => {
						seen.push([status, body]);
						throw new Error('handled');
					}
				}
			)
		).toThrow('handled');
		expect(seen).toEqual([[413, { message: expect.stringContaining('too large') }]]);
	});

	it('toWebResponse wraps toResponse into a real Response', async () => {
		const res = engine().toWebResponse({
			kind: 'ok',
			envelope: {
				body: 'hi',
				headers: { 'Content-Type': 'text/plain' },
				result: {} as never,
				metrics: {} as never
			},
			solveMs: 1,
			errorCount: 0,
			warningCount: 0
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('hi');
	});
});

describe('SolveEngine.stats', () => {
	it('aggregates client, byte-cache, and coalescing stats', () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const s = engine.stats();
		expect(s.client.warmClients).toBe(0);
		expect(s.definitionBytes.entries).toBe(0);
		expect(s.coalescing.inFlight).toBe(0);
	});
});
