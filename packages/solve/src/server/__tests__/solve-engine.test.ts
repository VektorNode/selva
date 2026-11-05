/**
 * Tests for `SolveEngine` — the facade composing the client cache, byte cache,
 * single-flight coalescer, and pipeline. `@selvajs/compute` is mocked, so these
 * run without a live compute server or a real Rhino.Compute handshake.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gunzipSync } from 'node:zlib';

type Recorded = Record<string, unknown>;

const createdConfigs: Recorded[] = [];
const createdSchedulerOptions: Recorded[] = [];
let createFailure: Error | null = null;
let scriptedSolve: (
	def: unknown,
	tree: unknown,
	opts: { signal?: AbortSignal }
) => Promise<Record<string, unknown>>;

vi.mock('@selvajs/compute/grasshopper', () => {
	class GrasshopperClient {
		static async create(config: Recorded) {
			if (createFailure) throw createFailure;
			createdConfigs.push(config);
			return new GrasshopperClient();
		}
		serverStats = { getActiveChildren: async () => null };
		createScheduler(options: Recorded) {
			createdSchedulerOptions.push(options);
			return {
				maxConcurrent: options.maxConcurrent as number,
				inFlightCount: 0,
				queueDepth: 0,
				solveDetailed: async (def: unknown, tree: unknown, opts: { signal?: AbortSignal }) => ({
					response: await scriptedSolve(def, tree, opts),
					fromCache: false,
					durationMs: 0
				}),
				cacheStats: () => ({ entries: 0, bytes: 0, hits: 0, misses: 0, evictions: 0 }),
				clearCache() {},
				setMaxConcurrent() {},
				dispose() {}
			};
		}
	}
	return {
		GrasshopperClient,
		TreeBuilder: {
			// Carries the values, so a key that ignored them would show up as a wrong coalesce.
			fromValues: (entries: unknown[]) => entries
		},
		stableStringify: (value: unknown) => JSON.stringify(value)
	};
});

vi.mock('@selvajs/compute/core', () => {
	class MockComputeError extends Error {
		code: string;
		constructor(message: string, code: string) {
			super(message);
			this.code = code;
		}
	}
	return {
		enableDebugLogging: vi.fn(),
		isDefinitionRef: (d: unknown) =>
			typeof d === 'object' &&
			d !== null &&
			!(d instanceof Uint8Array) &&
			typeof (d as Recorded).key === 'string' &&
			typeof (d as Recorded).load === 'function',
		ComputeError: MockComputeError,
		ErrorCodes: {
			QUEUE_FULL: 'QUEUE_FULL',
			QUEUE_TIMEOUT: 'QUEUE_TIMEOUT',
			ABORTED: 'ABORTED',
			TIMEOUT_ERROR: 'TIMEOUT_ERROR',
			RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE'
		}
	};
});

import { ComputeError } from '@selvajs/compute/core';
import { SolveEngine, type SolveEngineLimits, type SolveEngineSolveArgs } from '../solve-engine.js';
import type { SolveInput } from '../../shared/solve-input.js';

/** Flush microtasks until `check()` is truthy or `attempts` is exhausted.
 *  `getClient`'s async chain (client build + concurrency probe) hops several
 *  ticks before `scriptedSolve` runs. */
async function waitUntil(check: () => boolean, attempts = 20): Promise<void> {
	for (let i = 0; i < attempts && !check(); i++) {
		await Promise.resolve();
	}
}

function baseLimits(over: Partial<SolveEngineLimits> = {}): SolveEngineLimits {
	return {
		computeResponseMaxBytes: 10 * 1024 * 1024,
		computeServerCachesolve: true,
		computeMaxQueueDepth: 0,
		computeQueueWaitMs: 0,
		computeDefinitionCacheBytes: 10 * 1024 * 1024,
		computeSolveCacheBytes: 10 * 1024 * 1024,
		...over
	};
}

const server = { id: 'srv-1', serverUrl: 'https://compute.example' };
const inputs: SolveInput[] = [{ id: 'a', paramType: 'number', nickname: 'A' } as SolveInput];

function solveArgs(over: Partial<SolveEngineSolveArgs> = {}): SolveEngineSolveArgs {
	return {
		server,
		definitionSource: new Uint8Array([1]),
		definitionKey: 'k',
		inputs,
		values: {},
		signal: new AbortController().signal,
		...over
	};
}

/** A solve held open until the test releases it, recording the signal it ran under. */
function heldSolve(response: Record<string, unknown> = { values: [], errors: [], warnings: [] }) {
	let signal: AbortSignal | undefined;
	let runs = 0;
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	scriptedSolve = async (_def, _tree, opts) => {
		runs += 1;
		signal = opts.signal;
		await gate;
		return response;
	};
	return {
		release,
		signal: () => signal,
		runs: () => runs,
		started: () => waitUntil(() => signal !== undefined)
	};
}

const computeError = (code: string) =>
	new (ComputeError as unknown as new (m: string, c: string) => Error)(`failed: ${code}`, code);

const big = () => ({ values: 'x'.repeat(5000), errors: [], warnings: [] });

beforeEach(() => {
	createdConfigs.length = 0;
	createdSchedulerOptions.length = 0;
	createFailure = null;
	scriptedSolve = async () => ({ values: [], errors: [], warnings: [] });
});

describe('new SolveEngine', () => {
	it('forwards every limit to the layer that enforces it', async () => {
		const engine = new SolveEngine({
			limits: baseLimits({
				computeResponseMaxBytes: 1000,
				computeServerCachesolve: false,
				computeMaxQueueDepth: 7,
				computeQueueWaitMs: 900,
				computeSolveCacheBytes: 2048
			})
		});
		await engine.getClient(server);
		expect(createdConfigs[0]).toMatchObject({ maxResponseBytes: 1000, cachesolve: false });
		expect(createdSchedulerOptions[0]).toMatchObject({
			maxQueueDepth: 7,
			queueWaitMs: 900,
			cache: { maxBytes: 2048 }
		});
	});

	it('applies the definition byte budget', async () => {
		const engine = new SolveEngine({ limits: baseLimits({ computeDefinitionCacheBytes: 10 }) });
		await engine.definitionRef('big', async () => new Uint8Array(11)).load();
		expect(engine.stats().definitionBytes.entries).toBe(0);
		await engine.definitionRef('small', async () => new Uint8Array(9)).load();
		expect(engine.stats().definitionBytes.bytes).toBe(9);
	});

	it.each([
		['computeResponseMaxBytes', 0],
		['computeMaxQueueDepth', -1],
		['computeQueueWaitMs', Infinity],
		['computeDefinitionCacheBytes', NaN],
		['computeSolveCacheBytes', Infinity]
	])('refuses %s of %s, which would silently mean no limit', (name, value) => {
		expect(() => new SolveEngine({ limits: baseLimits({ [name]: value }) })).toThrow(RangeError);
	});

	it('accepts the 0s that mean "off"', () => {
		expect(
			() =>
				new SolveEngine({
					limits: baseLimits({
						computeMaxQueueDepth: 0,
						computeQueueWaitMs: 0,
						computeDefinitionCacheBytes: 0,
						computeSolveCacheBytes: 0
					})
				})
		).not.toThrow();
	});
});

describe('SolveEngine.solve — definitionSource variants', () => {
	it('raw bytes without definitionKey throws', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		await expect(engine.solve(solveArgs({ definitionKey: undefined }))).rejects.toThrow(
			'definitionKey is required'
		);
	});

	it('a pre-built ByteCacheRef from engine.definitionRef() is used directly, not double-wrapped', async () => {
		scriptedSolve = async (def) => {
			await (def as { load: () => Promise<Uint8Array> }).load();
			return { values: [], errors: [], warnings: [] };
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const load = vi.fn(async () => new Uint8Array([1]));
		const ref = engine.definitionRef('v-2', load);
		await ref.load(); // simulates a caller (e.g. schema backfill) materializing bytes first
		expect(load).toHaveBeenCalledTimes(1);

		const outcome = await engine.solve(solveArgs({ definitionSource: ref }));
		expect(outcome.kind).toBe('ok');
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('a plain external DefinitionRef passes through, reporting no def_bytes', async () => {
		let seen: unknown;
		scriptedSolve = async (def) => {
			seen = def;
			return { values: [], errors: [], warnings: [] };
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const externalRef = { key: 'ext-1', load: async () => new Uint8Array([2]) };
		const outcome = await engine.solve(solveArgs({ definitionSource: externalRef }));
		if (outcome.kind !== 'ok') throw new Error(outcome.kind);
		expect(seen).toBe(externalRef);
		expect(outcome.envelope.headers['Server-Timing']).not.toContain('def_bytes');
	});
});

describe('SolveEngine.solve — coalescing', () => {
	it('two concurrent identical solves run the pipeline once', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const p1 = engine.solve(solveArgs());
		const p2 = engine.solve(solveArgs());
		held.release();
		const [a, b] = await Promise.all([p1, p2]);
		expect(held.runs()).toBe(1);
		expect(a.kind).toBe('ok');
		expect(b.kind).toBe('ok');
	});

	it('a caller after an eviction does not join a flight on the old client', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const draining = engine.solve(solveArgs());
		await waitUntil(() => held.runs() === 1);
		engine.evictServer(server.id);

		const rotated = engine.solve(solveArgs());
		await waitUntil(() => held.runs() === 2, 100);
		expect(held.runs()).toBe(2);

		held.release();
		await Promise.all([draining, rotated]);
	});

	it('live solves never coalesce, so one owner cancelling cannot abort another', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const live = (solveId: string) => ({ url: 'https://selva.example/cb', solveId, token: 't' });
		const p1 = engine.solve(solveArgs({ selvaEvents: live('s1') }));
		const p2 = engine.solve(solveArgs({ selvaEvents: live('s2') }));
		const p3 = engine.solve(solveArgs());
		await waitUntil(() => held.runs() === 3);
		expect(held.runs()).toBe(3);
		held.release();
		await Promise.all([p1, p2, p3]);
	});

	it('different values do not coalesce', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const p1 = engine.solve(solveArgs({ values: { a: 1 } }));
		const p2 = engine.solve(solveArgs({ values: { a: 2 } }));
		await waitUntil(() => held.runs() === 2);
		expect(held.runs()).toBe(2);
		held.release();
		await Promise.all([p1, p2]);
	});

	it('the same values on two definitions do not coalesce', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const p1 = engine.solve(solveArgs({ definitionKey: 'one' }));
		const p2 = engine.solve(solveArgs({ definitionKey: 'two' }));
		await waitUntil(() => held.runs() === 2);
		expect(held.runs()).toBe(2);
		held.release();
		await Promise.all([p1, p2]);
	});

	it('gives each coalesced caller the encoding it asked for', async () => {
		const response = big();
		const held = heldSolve(response);
		const engine = new SolveEngine({ limits: baseLimits() });
		const gzip = engine.solve(solveArgs({ acceptEncoding: 'gzip' }));
		const plain = engine.solve(solveArgs({ acceptEncoding: 'gzip;q=0' }));
		held.release();
		const [a, b] = await Promise.all([gzip, plain]);
		if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expected ok');

		expect(a.envelope.headers['Content-Encoding']).toBe('gzip');
		expect(a.envelope.metrics.compressedBytes).toBeGreaterThan(0);
		expect(JSON.parse(gunzipSync(a.envelope.body as Uint8Array).toString())).toEqual(response);

		expect(b.envelope.headers['Content-Encoding']).toBeUndefined();
		expect(b.envelope.metrics.compressedBytes).toBeNull();
		expect(JSON.parse(b.envelope.body as string)).toEqual(response);
	});

	it('gives each coalesced caller its own timing and its own headers', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const p1 = engine.solve(solveArgs({ prepMarks: [['first', 1]], defLoadMs: 12.3 }));
		const p2 = engine.solve(solveArgs({ prepMarks: [['second', 2]] }));
		held.release();
		const [a, b] = await Promise.all([p1, p2]);
		if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expected ok');

		expect(a.envelope.headers).not.toBe(b.envelope.headers);
		expect(a.envelope.headers['Server-Timing']).toContain('p_first;dur=1.0');
		expect(a.envelope.headers['Server-Timing']).toContain('load;dur=12.3');
		expect(b.envelope.headers['Server-Timing']).toContain('p_second;dur=2.0');
		expect(b.envelope.headers['Server-Timing']).not.toContain('p_first');
	});

	it("a joiner reports the flight's def_bytes verdict, not its own unused ref", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		scriptedSolve = async (def) => {
			await (def as { load: () => Promise<Uint8Array> }).load();
			await gate;
			return { values: [], errors: [], warnings: [] };
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const load = async () => new Uint8Array([1]);
		const p1 = engine.solve(solveArgs({ definitionSource: engine.definitionRef('v', load) }));
		await waitUntil(() => engine.stats().coalescing.inFlight === 1);
		const p2 = engine.solve(solveArgs({ definitionSource: engine.definitionRef('v', load) }));
		await waitUntil(() => engine.stats().definitionBytes.misses === 1);
		release();
		const [, joiner] = await Promise.all([p1, p2]);
		if (joiner.kind !== 'ok') throw new Error(joiner.kind);
		expect(joiner.envelope.headers['Server-Timing']).toContain('def_bytes;desc=miss');
	});

	it('names the coalesced join to the host', async () => {
		const held = heldSolve();
		const onSolveCoalesced = vi.fn();
		const engine = new SolveEngine({ limits: baseLimits(), onSolveCoalesced });
		const p1 = engine.solve(solveArgs());
		const p2 = engine.solve(solveArgs());
		await waitUntil(() => onSolveCoalesced.mock.calls.length === 1);
		held.release();
		await Promise.all([p1, p2]);
		expect(onSolveCoalesced).toHaveBeenCalledTimes(1);
	});
});

describe('SolveEngine.solve — abort', () => {
	it('an already-aborted caller pays for nothing', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const controller = new AbortController();
		controller.abort();
		const outcome = await engine.solve(solveArgs({ signal: controller.signal }));
		expect(outcome.kind).toBe('client_abort');
		expect(held.runs()).toBe(0);
		expect(createdConfigs).toHaveLength(0);
	});

	it('a caller gone during the connect pays for no solve', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const controller = new AbortController();
		const solving = engine.solve(solveArgs({ signal: controller.signal }));
		controller.abort();
		expect((await solving).kind).toBe('client_abort');
		expect(held.runs()).toBe(0);
	});

	it('a solo caller aborting propagates to the pipeline signal', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const controller = new AbortController();
		void engine.solve(solveArgs({ signal: controller.signal }));
		await held.started();
		controller.abort();
		expect(held.signal()?.aborted).toBe(true);
	});

	it('a shared flight survives one caller leaving, whichever it is', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		const owner = new AbortController();
		const stays = engine.solve(solveArgs());
		const leaves = engine.solve(solveArgs({ signal: owner.signal }));
		await held.started();
		owner.abort();
		expect(held.signal()?.aborted).toBe(false);
		held.release();
		expect((await stays).kind).toBe('ok');
		expect((await leaves).kind).toBe('client_abort');
	});

	it('cancels upstream and settles both when every caller has gone', async () => {
		let settle!: () => void;
		scriptedSolve = (_def, _tree, opts) =>
			new Promise((_, reject) => {
				settle = () => reject(computeError('ABORTED'));
				opts.signal?.addEventListener('abort', settle);
			});
		const engine = new SolveEngine({ limits: baseLimits() });
		const a = new AbortController();
		const b = new AbortController();
		const p1 = engine.solve(solveArgs({ signal: a.signal }));
		const p2 = engine.solve(solveArgs({ signal: b.signal }));
		await waitUntil(() => settle !== undefined);
		b.abort();
		a.abort();
		const [one, two] = await Promise.all([p1, p2]);
		expect(one.kind).toBe('client_abort');
		expect(two.kind).toBe('client_abort');
		expect(engine.stats().coalescing.inFlight).toBe(0);
	});

	it('a live caller arriving as the last one leaves gets its own solve, not a 499', async () => {
		let runs = 0;
		scriptedSolve = (_def, _tree, opts) => {
			runs += 1;
			const signal = opts.signal;
			return runs === 1
				? new Promise((_, reject) =>
						signal?.addEventListener('abort', () => reject(computeError('ABORTED')))
					)
				: Promise.resolve({ values: [], errors: [], warnings: [] });
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const leaving = new AbortController();
		const first = engine.solve(solveArgs({ signal: leaving.signal }));
		await waitUntil(() => runs === 1);
		leaving.abort();
		const live = await engine.solve(solveArgs());
		expect(live.kind).toBe('ok');
		expect((await first).kind).toBe('client_abort');
	});

	it('a caller that left a shared flight settles as gone, not with the result', async () => {
		const held = heldSolve(big());
		let joined = false;
		const engine = new SolveEngine({
			limits: baseLimits(),
			onSolveCoalesced: () => (joined = true)
		});
		const controller = new AbortController();
		const leaves = engine.solve(solveArgs({ signal: controller.signal, acceptEncoding: '' }));
		await held.started();
		const alone = engine.solve(solveArgs({ acceptEncoding: 'gzip' }));
		await waitUntil(() => joined);
		controller.abort();
		held.release();
		const gone = await leaves;
		await alone;

		expect(gone.kind).toBe('client_abort');
	});
});

describe('SolveEngine.solve — outcomes', () => {
	it('returns compute_error when the handshake fails, rather than throwing', async () => {
		createFailure = new Error('refused');
		const engine = new SolveEngine({ limits: baseLimits() });
		const outcome = await engine.solve(solveArgs());
		expect(outcome).toMatchObject({ kind: 'compute_error', error: createFailure });
	});

	it('returns compute_error when the input tree cannot be built', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const outcome = await engine.solve(solveArgs({ inputs: [null] as unknown as SolveInput[] }));
		expect(outcome.kind).toBe('compute_error');
	});

	it('reads a client shut down during the connect as retryable, never as a failure', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const solving = engine.solve(solveArgs());
		engine.evictServer(server.id);
		const outcome = await solving;
		expect(outcome).toMatchObject({ kind: 'shed', reason: 'interrupted' });
	});

	it('passes a failed flight through to every caller', async () => {
		scriptedSolve = async () => {
			throw computeError('TIMEOUT_ERROR');
		};
		const engine = new SolveEngine({ limits: baseLimits() });
		const [a, b] = await Promise.all([engine.solve(solveArgs()), engine.solve(solveArgs())]);
		expect(a).toMatchObject({ kind: 'timeout', message: expect.stringContaining('100s') });
		expect(b.kind).toBe('timeout');
	});

	it('returns too_large past the response cap', async () => {
		scriptedSolve = async () => big();
		const engine = new SolveEngine({ limits: baseLimits({ computeResponseMaxBytes: 100 }) });
		expect((await engine.solve(solveArgs())).kind).toBe('too_large');
	});

	it('returns compute_error when the response cannot be serialized', async () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		scriptedSolve = async () => cyclic;
		const engine = new SolveEngine({ limits: baseLimits() });
		expect((await engine.solve(solveArgs())).kind).toBe('compute_error');
	});

	it('counts errors and warnings, and times its own tree build', async () => {
		scriptedSolve = async () => ({ values: [], errors: ['e'], warnings: ['w', 'x'] });
		const engine = new SolveEngine({ limits: baseLimits() });
		const outcome = await engine.solve(solveArgs());
		if (outcome.kind !== 'ok') throw new Error(outcome.kind);
		expect(outcome).toMatchObject({ errorCount: 1, warningCount: 2 });
		expect(outcome.envelope.metrics.treeBuildMs).toBeGreaterThanOrEqual(0);
		expect(outcome.envelope.headers['Server-Timing']).toContain('tree;dur=');
	});

	it('carries what the Server-Timing header says as data', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const outcome = await engine.solve(solveArgs({ defLoadMs: 12 }));
		if (outcome.kind !== 'ok') throw new Error(outcome.kind);
		expect(outcome.envelope.metrics).toMatchObject({
			defLoadMs: 12,
			rhino: null,
			settle: { fromCache: false }
		});
	});

	it('measures total from the host request start', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const outcome = await engine.solve(solveArgs({ loadStartMs: performance.now() - 5_000 }));
		if (outcome.kind !== 'ok') throw new Error(outcome.kind);
		expect(outcome.envelope.metrics.serverTotalMs).toBeGreaterThanOrEqual(5_000);
	});
});

describe('SolveEngine facade', () => {
	it('evictServer forces a rebuild', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const first = await engine.getClient(server);
		engine.evictServer(server.id);
		expect(await engine.getClient(server)).not.toBe(first);
	});

	it('clearDefinitionCache forces a storage re-read', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const load = vi.fn(async () => new Uint8Array([1]));
		await engine.definitionRef('v', load).load();
		engine.clearDefinitionCache();
		await engine.definitionRef('v', load).load();
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('clearSolveCaches keeps the warm client', async () => {
		const engine = new SolveEngine({ limits: baseLimits() });
		const client = await engine.getClient(server);
		engine.clearSolveCaches();
		expect(await engine.getClient(server)).toBe(client);
	});

	it('stats reports warm clients, retained bytes and flights in progress', async () => {
		const held = heldSolve();
		const engine = new SolveEngine({ limits: baseLimits() });
		await engine.definitionRef('v', async () => new Uint8Array(3)).load();
		const solving = engine.solve(solveArgs());
		await held.started();

		const stats = engine.stats();
		expect(stats.client.warmClients).toBe(1);
		expect(stats.definitionBytes.bytes).toBe(3);
		expect(stats.coalescing.inFlight).toBe(1);

		held.release();
		await solving;
		expect(engine.stats().coalescing.inFlight).toBe(0);
	});

	it('sends debug lines to onDebugLog', async () => {
		const lines: string[] = [];
		const engine = new SolveEngine({
			limits: baseLimits(),
			debug: true,
			onDebugLog: (line) => lines.push(line)
		});
		await engine.getClient(server);
		expect(lines.join('\n')).toContain('building warm client');
	});
});

describe('SolveEngine.toWebResponse', () => {
	const engine = () => new SolveEngine({ limits: baseLimits() });

	it('ok -> 200 with envelope body/headers', async () => {
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
		expect(res.headers.get('Content-Type')).toBe('text/plain');
		expect(await res.text()).toBe('hi');
	});

	it('sends a gzip body as bytes', async () => {
		const res = engine().toWebResponse({
			kind: 'ok',
			envelope: {
				body: new Uint8Array([1, 2, 3]),
				encoding: 'gzip',
				headers: {},
				result: {} as never,
				metrics: {} as never
			},
			solveMs: 1,
			errorCount: 0,
			warningCount: 0
		});
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('timeout -> 504 carrying the message', async () => {
		const res = engine().toWebResponse({ kind: 'timeout', durationMs: 1, message: 'slow' });
		expect(res.status).toBe(504);
		expect(await res.json()).toEqual({ message: 'slow' });
	});

	it('client_abort -> 499', () => {
		expect(engine().toWebResponse({ kind: 'client_abort', durationMs: 1 }).status).toBe(499);
	});

	it('too_large -> 413', () => {
		expect(engine().toWebResponse({ kind: 'too_large' }).status).toBe(413);
	});

	it.each(['queue_full', 'queue_timeout', 'interrupted'] as const)(
		'shed (%s) -> 503 with Retry-After',
		(reason) => {
			const res = engine().toWebResponse({
				kind: 'shed',
				durationMs: 1,
				reason,
				retryAfterSeconds: 3,
				message: 'busy'
			});
			expect(res.status).toBe(503);
			expect(res.headers.get('Retry-After')).toBe('3');
		}
	);

	it('compute_error throws the original error for the host to map', () => {
		const err = new Error('boom');
		expect(() =>
			engine().toWebResponse({ kind: 'compute_error', durationMs: 1, error: err })
		).toThrow(err);
	});
});
