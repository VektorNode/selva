/**
 * Tests for `createClientCache` — the per-server warm-client LRU.
 *
 * `@selvajs/compute`'s `GrasshopperClient.create` does a real network preflight,
 * so we mock the module: `create` records the config it was called with and
 * returns a fake client whose `createScheduler` returns a disposable stub. That
 * lets us assert the cache's own behavior (id-keying, LRU eviction, evict,
 * disposeAll, the `X-Selva-Definition` header) without a live compute server.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// --- Mock @selvajs/compute -------------------------------------------------
//
// Loose records, not the real config types: the cache passes values through untouched, and
// pinning the upstream shapes here would just couple these tests to `@selvajs/compute`.
// `unknown` rather than `any` so the few assertions that index into these need a cast —
// `prop()` below does it in one place instead of the type opting out everywhere.
type Recorded = Record<string, unknown>;

/** Read a recorded property. The cast is the point of `Recorded` being `unknown`-valued. */
function prop<T = unknown>(record: Recorded | undefined, key: string): T {
	return record?.[key] as T;
}

const createdConfigs: Recorded[] = [];
const createdSchedulerOptions: Recorded[] = [];
const disposedSchedulers: { disposed: boolean }[] = [];

// Child count the mocked server reports from `/activechildren`. `null` stands in
// for a server that cannot answer (stock McNeel build, network blip).
let activeChildren: number | null = null;

// What the mocked server reports from `/limits`. `null` is a server without the route.
let reportedLimits: Recorded | null = null;

// When set, `create` rejects with this instead of returning a client — stands in
// for an unreachable compute server failing the liveness preflight.
let createFailure: Error | null = null;
let createCalls = 0;
// When set, `create` waits for it first — a handshake still running.
let createGate: Promise<void> | null = null;

vi.mock('@selvajs/compute/grasshopper', () => {
	class GrasshopperClient {
		static async create(config: Recorded) {
			createCalls += 1;
			const gate = createGate;
			if (gate) await gate;
			if (createFailure) throw createFailure;
			createdConfigs.push(config);
			return new GrasshopperClient(config);
		}
		constructor(public config: Recorded) {}
		serverStats = {
			getActiveChildren: async () => activeChildren,
			getLimits: async () => reportedLimits
		};
		createScheduler(options: Recorded) {
			createdSchedulerOptions.push(options);
			const scheduler = {
				disposed: false,
				inFlightCount: 0,
				queueDepth: 0,
				clears: 0,
				clearCache() {
					this.clears += 1;
				},
				// Mirrors the real scheduler's mutable cap so tests can assert what a
				// post-solve probe actually applied, not just what was passed at build.
				maxConcurrent: options.maxConcurrent as number,
				// Each scheduler owns its own solve cache; `solveCacheStats()` sums
				// them, so tests set distinct numbers per client to prove the sum.
				stats: { entries: 0, bytes: 0, hits: 0, misses: 0, evictions: 0 },
				cacheStats() {
					return this.stats;
				},
				setMaxConcurrent(n: number) {
					this.maxConcurrent = n;
				},
				/** Drive the cache's `onSettle` hook the way a finished solve would. */
				settle(result: Recorded) {
					(options.onSettle as (c: Recorded, r: Recorded) => void)?.({}, result);
				},
				dispose() {
					this.disposed = true;
					disposedSchedulers.push(this);
				}
			};
			return scheduler;
		}
	}
	return { GrasshopperClient };
});

vi.mock('@selvajs/compute/core', async (importOriginal) => {
	const { ErrorCodes } = await importOriginal<typeof import('@selvajs/compute/core')>();
	class MockComputeError extends Error {
		constructor(
			message: string,
			public code: string
		) {
			super(message);
		}
	}
	return {
		enableDebugLogging: vi.fn(),
		ComputeError: MockComputeError,
		ErrorCodes
	};
});

import { createClientCache } from '../client-cache.js';

function baseConfig() {
	return {
		maxQueueDepth: 0,
		queueWaitMs: 0,
		cachesolve: true,
		responseCacheMaxBytes: 256 * 1024 * 1024,
		maxResponseBytes: 300 * 1024 * 1024,
		debug: false as boolean | 'verbose'
	};
}

const server = (id: string, over: Partial<{ serverUrl: string; apiKey: string }> = {}) => ({
	id,
	serverUrl: over.serverUrl ?? `http://compute-${id}:6500`,
	apiKey: over.apiKey ?? `key-${id}`
});

beforeEach(() => {
	createdConfigs.length = 0;
	createdSchedulerOptions.length = 0;
	disposedSchedulers.length = 0;
	activeChildren = null;
	reportedLimits = null;
	createFailure = null;
	createCalls = 0;
	createGate = null;
});

/** Holds `create` until `release()`, so a test can act while a build runs. */
function holdBuilds() {
	let release!: () => void;
	createGate = new Promise((resolve) => (release = resolve));
	return () => {
		createGate = null;
		release();
	};
}

/** The mock scheduler behind a warm client, with what a test scripts on it. */
function mockScheduler(entry: unknown) {
	return (entry as { scheduler: MockScheduler }).scheduler;
}

interface MockScheduler {
	disposed: boolean;
	inFlightCount: number;
	queueDepth: number;
	clears: number;
	settle(result: Recorded): void;
}

/** What the real scheduler does when a solve finishes: the hook, then the count drops. */
function finishSolve(scheduler: MockScheduler, result: Recorded = { status: 'success' }) {
	scheduler.settle({ durationMs: 1, ...result });
	scheduler.inFlightCount -= 1;
	return Promise.resolve();
}

describe('createClientCache — fetch', () => {
	it('hands the client its own fetch, since the server may allow a deadline past undici limits', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('a'));
		expect(prop(createdConfigs[0], 'fetch')).toBeTypeOf('function');
	});
});

describe('createClientCache — limits from the server', () => {
	it('takes the deadline from the server timeout, with slack, and allows pointer reuse', async () => {
		reportedLimits = { timeoutSeconds: 1800, maxRequestBytes: 1024, signalsStaleDefinition: true };
		const cache = createClientCache(baseConfig());
		const entry = await cache.getClient(server('a'));
		expect(createdSchedulerOptions[0]).toMatchObject({
			timeoutMs: 1_805_000,
			reuseServerDefinitionCache: true
		});
		expect(entry.limits).toEqual({
			solveDeadlineMs: 1_805_000,
			maxRequestBytes: 1024,
			reuseDefinitionCache: true,
			deploymentId: null
		});
	});

	it('sends the whole definition to a server that answers a stale pointer with empty geometry', async () => {
		reportedLimits = { timeoutSeconds: 100, maxRequestBytes: 1, signalsStaleDefinition: false };
		const cache = createClientCache(baseConfig());
		const entry = await cache.getClient(server('a'));
		expect(createdSchedulerOptions[0]).toMatchObject({ reuseServerDefinitionCache: false });
		expect(entry.limits.reuseDefinitionCache).toBe(false);
	});

	it('caps the deadline at an hour', async () => {
		reportedLimits = { timeoutSeconds: 86_400, maxRequestBytes: 1, signalsStaleDefinition: true };
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('a'));
		expect(createdSchedulerOptions[0].timeoutMs).toBe(3_600_000);
	});

	it("falls back to Compute's defaults and no pointer reuse on a server that can't report", async () => {
		const cache = createClientCache(baseConfig());
		const entry = await cache.getClient(server('a'));
		expect(createdSchedulerOptions[0]).toMatchObject({
			timeoutMs: 100_000,
			reuseServerDefinitionCache: false
		});
		expect(entry.limits.maxRequestBytes).toBeNull();
	});

	it('rebuilds the client when the server reports new limits', async () => {
		vi.useFakeTimers();
		try {
			reportedLimits = { timeoutSeconds: 100, maxRequestBytes: 1, signalsStaleDefinition: true };
			const cache = createClientCache(baseConfig());
			const first = await cache.getClient(server('a'));
			reportedLimits = { timeoutSeconds: 600, maxRequestBytes: 1, signalsStaleDefinition: true };
			vi.advanceTimersByTime(5 * 60 * 1000);
			(first.scheduler as unknown as { settle(r: Recorded): void }).settle({
				status: 'success',
				durationMs: 1
			});
			await vi.waitFor(async () => {
				expect(await cache.getClient(server('a'))).not.toBe(first);
			});
			expect(createdSchedulerOptions.at(-1)?.timeoutMs).toBe(605_000);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('createClientCache — a redeployed server', () => {
	const limitsOf = (deploymentId: string) => ({
		timeoutSeconds: 100,
		maxRequestBytes: 1,
		signalsStaleDefinition: true,
		deploymentId
	});
	type LimitsClient = { client: { serverStats: { getLimits: () => Promise<unknown> } } };

	async function warmThenAdvance(config = baseConfig()) {
		reportedLimits = limitsOf('d1');
		const cache = createClientCache(config);
		const first = await cache.getClient(server('a'));
		let reads = 0;
		const stats = (first as unknown as LimitsClient).client.serverStats;
		const read = stats.getLimits;
		stats.getLimits = () => {
			reads += 1;
			return read();
		};
		return { cache, first, stats, reads: () => reads };
	}

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('hands out a warm client checked within 30 s without asking the server', async () => {
		const { cache, first, reads } = await warmThenAdvance();
		vi.advanceTimersByTime(29_000);
		expect(await cache.getClient(server('a'))).toBe(first);
		expect(reads()).toBe(0);
	});

	it('keeps the client, and its cache, while the deployment is the same', async () => {
		const { cache, first, reads } = await warmThenAdvance();
		vi.advanceTimersByTime(31_000);
		expect(await cache.getClient(server('a'))).toBe(first);
		expect(reads()).toBe(1);
		expect(mockScheduler(first).disposed).toBe(false);
	});

	it('rebuilds with an empty cache once the server reports another deployment', async () => {
		const { cache, first } = await warmThenAdvance();
		reportedLimits = limitsOf('d2');
		vi.advanceTimersByTime(31_000);
		const next = await cache.getClient(server('a'));
		expect(next).not.toBe(first);
		expect(next.limits.deploymentId).toBe('d2');
		expect(mockScheduler(first).disposed).toBe(true);
	});

	it('does not hold a request on a server that does not answer, and retires it once it does', async () => {
		const { cache, first, stats } = await warmThenAdvance();
		let answer!: (v: unknown) => void;
		stats.getLimits = () => new Promise((resolve) => (answer = resolve));
		vi.advanceTimersByTime(31_000);

		const served = cache.getClient(server('a'));
		await vi.advanceTimersByTimeAsync(1000);
		expect(await served).toBe(first);

		answer(limitsOf('d2'));
		await vi.waitFor(() => expect(mockScheduler(first).disposed).toBe(true));
	});

	it('keeps the client when a server that reported its limits stops answering', async () => {
		const { cache, first, stats } = await warmThenAdvance();
		stats.getLimits = async () => null;
		vi.advanceTimersByTime(31_000);
		expect(await cache.getClient(server('a'))).toBe(first);
		expect(first.limits.reuseDefinitionCache).toBe(true);
	});

	it('never checks with the solve cache off', async () => {
		const { cache, first, reads } = await warmThenAdvance({
			...baseConfig(),
			responseCacheMaxBytes: 0
		});
		reportedLimits = limitsOf('d2');
		vi.advanceTimersByTime(31_000);
		expect(await cache.getClient(server('a'))).toBe(first);
		expect(reads()).toBe(0);
	});
});

describe('createClientCache — concurrency vs. the server child count', () => {
	it('always adopts the server child count in queue mode, never an operator-supplied cap', async () => {
		activeChildren = 8;
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('a'));
		expect(createdSchedulerOptions[0].maxConcurrent).toBe(8);
		// Queue mode with NO maxConcurrent defaults to 1 in the scheduler, serializing every solve.
		expect(createdSchedulerOptions[0].mode).toBe('queue');
	});

	it('falls back to 1 when the server cannot report a count', async () => {
		activeChildren = null;
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('a'));
		expect(createdSchedulerOptions[0].maxConcurrent).toBe(1);
	});

	it('falls back to 1 on a nonsense (0) count rather than serializing on a guess', async () => {
		activeChildren = 0;
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('a'));
		expect(createdSchedulerOptions[0].maxConcurrent).toBe(1);
	});

	it.each([
		['grew after connect', 2, 8],
		['recovered after an earlier failed probe', null, 6]
	])('picks up a pool that %s, once the probe window has passed', async (_name, before, after) => {
		vi.useFakeTimers();
		try {
			activeChildren = before;
			const cache = createClientCache(baseConfig());
			const entry = (await cache.getClient(server('a'))) as unknown as {
				scheduler: { maxConcurrent: number; settle(r: Recorded): void };
			};
			expect(entry.scheduler.maxConcurrent).toBe(before ?? 1);

			// An operator adds workers; nothing tells us until the next probe.
			activeChildren = after;
			vi.advanceTimersByTime(6 * 60 * 1000);
			entry.scheduler.settle({ status: 'success', fromCache: false, durationMs: 1 });
			await vi.waitFor(() => expect(entry.scheduler.maxConcurrent).toBe(after));
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not re-probe on every solve', async () => {
		let probes = 0;
		activeChildren = 4;
		const cache = createClientCache(baseConfig());
		const entry = (await cache.getClient(server('a'))) as unknown as {
			client: { serverStats: { getActiveChildren: () => Promise<number | null> } };
			scheduler: { settle(r: Recorded): void };
		};
		entry.client.serverStats.getActiveChildren = async () => {
			probes += 1;
			return activeChildren;
		};

		for (let i = 0; i < 5; i++) {
			entry.scheduler.settle({ status: 'success', fromCache: false, durationMs: 1 });
		}
		expect(probes).toBe(0);
	});

	it('spends no probe on a cache hit, which never reached the server', async () => {
		vi.useFakeTimers();
		try {
			activeChildren = 2;
			const cache = createClientCache(baseConfig());
			const entry = (await cache.getClient(server('a'))) as unknown as {
				scheduler: { maxConcurrent: number; settle(r: Recorded): void };
			};

			activeChildren = 8;
			vi.advanceTimersByTime(6 * 60 * 1000);
			entry.scheduler.settle({ status: 'success', fromCache: true, durationMs: 0 });
			await Promise.resolve();
			expect(entry.scheduler.maxConcurrent).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('createClientCache — keying', () => {
	it('reuses the entry even when the URL/apiKey rotate under the same id', async () => {
		// Identity is the id, so a rotated URL is the SAME entry (stale until
		// evicted), not a new client.
		const cache = createClientCache(baseConfig());
		const a = await cache.getClient(server('s1', { serverUrl: 'http://old:6500' }));
		const b = await cache.getClient(server('s1', { serverUrl: 'http://new:6500' }));
		expect(a).toBe(b);
		expect(createdConfigs).toHaveLength(1);
		// It kept the ORIGINAL connection details — proving eviction is required.
		expect(createdConfigs[0].serverUrl).toBe('http://old:6500');
	});

	it('builds distinct clients for distinct ids', async () => {
		const cache = createClientCache(baseConfig());
		const a = await cache.getClient(server('s1'));
		const b = await cache.getClient(server('s2'));
		expect(a).not.toBe(b);
		expect(createdConfigs).toHaveLength(2);
	});

	it('coalesces concurrent builds for the same id into one client', async () => {
		// Two requests racing on a cold key must share ONE build — without
		// coalescing both handshake and the loser's client is overwritten in the
		// map without ever being disposed.
		const cache = createClientCache(baseConfig());
		const [a, b] = await Promise.all([
			cache.getClient(server('s1')),
			cache.getClient(server('s1'))
		]);
		expect(a).toBe(b);
		expect(createdConfigs).toHaveLength(1);
	});
});

describe('createClientCache — LRU eviction', () => {
	it('evicts the least-recently-used entry past capacity and disposes its scheduler', async () => {
		const cache = createClientCache({ ...baseConfig(), maxWarmComputeServers: 2 });
		const s1 = await cache.getClient(server('s1'));
		await cache.getClient(server('s2'));
		// Touch s1 so s2 becomes the LRU.
		await cache.getClient(server('s1'));
		await cache.getClient(server('s3')); // over capacity → evict s2

		expect(disposedSchedulers).toHaveLength(1);
		// s1 still warm (same entry, no rebuild); s2 rebuilt on next access.
		expect(await cache.getClient(server('s1'))).toBe(s1);
		expect(createdConfigs.filter((c) => prop<string>(c, 'serverUrl').includes('s2'))).toHaveLength(
			1
		);
		await cache.getClient(server('s2'));
		expect(createdConfigs.filter((c) => prop<string>(c, 'serverUrl').includes('s2'))).toHaveLength(
			2
		);
	});
});

describe('createClientCache — explicit invalidation', () => {
	it('evict(id) disposes the scheduler and forces a rebuild (config-write hook)', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'));
		cache.evict('s1');
		expect(disposedSchedulers).toHaveLength(1);
		await cache.getClient(server('s1'));
		expect(createdConfigs).toHaveLength(2);
	});

	it('evict on an unknown id is a no-op', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'));
		cache.evict('nope');
		expect(disposedSchedulers).toHaveLength(0);
	});

	it('disposeAll disposes every warm scheduler and clears the cache', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'));
		await cache.getClient(server('s2'));
		cache.disposeAll();
		expect(disposedSchedulers).toHaveLength(2);
		// Next access rebuilds.
		await cache.getClient(server('s1'));
		expect(createdConfigs).toHaveLength(3);
	});

	it('clearSolveCaches clears every warm client, keeping them warm', async () => {
		const cache = createClientCache(baseConfig());
		const a = await cache.getClient(server('a'));
		const b = await cache.getClient(server('b'));
		cache.clearSolveCaches();
		expect(mockScheduler(a).clears).toBe(1);
		expect(mockScheduler(b).clears).toBe(1);
		expect(await cache.getClient(server('a'))).toBe(a);
		expect(disposedSchedulers).toHaveLength(0);
	});
});

describe('createClientCache — retiring a busy client', () => {
	it('evict lets running solves finish, then disposes', async () => {
		const cache = createClientCache(baseConfig());
		const scheduler = mockScheduler(await cache.getClient(server('s1')));
		scheduler.inFlightCount = 2;

		cache.evict('s1');
		expect(scheduler.disposed).toBe(false);

		await finishSolve(scheduler);
		expect(scheduler.disposed).toBe(false);
		await finishSolve(scheduler);
		expect(scheduler.disposed).toBe(true);
	});

	it('waits for a queued solve too', async () => {
		const cache = createClientCache(baseConfig());
		const scheduler = mockScheduler(await cache.getClient(server('s1')));
		scheduler.inFlightCount = 1;
		scheduler.queueDepth = 1;

		cache.evict('s1');
		await finishSolve(scheduler);
		expect(scheduler.disposed).toBe(false);

		scheduler.queueDepth = 0;
		scheduler.inFlightCount = 1;
		await finishSolve(scheduler, { status: 'error' });
		expect(scheduler.disposed).toBe(true);
	});

	it('the next request builds a new client while the old one drains', async () => {
		const cache = createClientCache(baseConfig());
		const old = await cache.getClient(server('s1'));
		mockScheduler(old).inFlightCount = 1;
		cache.evict('s1');
		expect(await cache.getClient(server('s1'))).not.toBe(old);
		expect(createdConfigs).toHaveLength(2);
	});

	it('the LRU retires a busy client the same way', async () => {
		const cache = createClientCache({ ...baseConfig(), maxWarmComputeServers: 1 });
		const scheduler = mockScheduler(await cache.getClient(server('s1')));
		scheduler.inFlightCount = 1;
		await cache.getClient(server('s2'));
		expect(scheduler.disposed).toBe(false);
		await finishSolve(scheduler);
		expect(scheduler.disposed).toBe(true);
	});

	it('a solve settling on a warm client disposes nothing', async () => {
		const cache = createClientCache(baseConfig());
		const scheduler = mockScheduler(await cache.getClient(server('s1')));
		scheduler.inFlightCount = 1;
		await finishSolve(scheduler);
		expect(scheduler.disposed).toBe(false);
	});

	it('disposeAll does not wait', async () => {
		const cache = createClientCache(baseConfig());
		const warm = mockScheduler(await cache.getClient(server('s1')));
		warm.inFlightCount = 1;
		const draining = mockScheduler(await cache.getClient(server('s2')));
		draining.inFlightCount = 1;
		cache.evict('s2');

		cache.disposeAll();
		expect(warm.disposed).toBe(true);
		expect(draining.disposed).toBe(true);
	});
});

describe('createClientCache — evict during a build', () => {
	it('the old connection details are never installed', async () => {
		const release = holdBuilds();
		const cache = createClientCache(baseConfig());
		const old = cache.getClient(server('s1', { serverUrl: 'http://old:6500', apiKey: 'OLD' }));
		await Promise.resolve();

		cache.evict('s1');
		release();
		await expect(old).rejects.toMatchObject({ code: 'ABORTED' });
		expect(disposedSchedulers).toHaveLength(1);

		await cache.getClient(server('s1', { serverUrl: 'http://new:6500', apiKey: 'NEW' }));
		expect(createdConfigs.at(-1)).toMatchObject({ serverUrl: 'http://new:6500', apiKey: 'NEW' });
		expect(cache.solveCacheStats().warmClients).toBe(1);
	});

	it('a caller after the evict builds fresh instead of joining the stale build', async () => {
		const release = holdBuilds();
		const cache = createClientCache(baseConfig());
		const old = cache.getClient(server('s1'));
		await Promise.resolve();
		cache.evict('s1');

		const fresh = cache.getClient(server('s1'));
		release();
		await old.catch(() => {});
		await expect(fresh).resolves.toBeDefined();
		expect(createCalls).toBe(2);
	});

	it('the stale build settling leaves the newer build alone', async () => {
		const releaseOld = holdBuilds();
		const cache = createClientCache(baseConfig());
		const old = cache.getClient(server('s1'));
		await Promise.resolve();
		cache.evict('s1');

		const releaseNew = holdBuilds();
		const newer = cache.getClient(server('s1'));
		await Promise.resolve();
		releaseOld();
		await old.catch(() => {});

		// Joins the build still running rather than starting a third.
		const joined = cache.getClient(server('s1'));
		releaseNew();
		expect(await joined).toBe(await newer);
		expect(createCalls).toBe(2);
	});

	it("a stale build's failure does not replay against the corrected config", async () => {
		const release = holdBuilds();
		const cache = createClientCache(baseConfig());
		const old = cache.getClient(server('s1'));
		await Promise.resolve();
		cache.evict('s1');

		createFailure = new Error('401 with the old key');
		release();
		await expect(old).rejects.toThrow('401');

		createFailure = null;
		await expect(cache.getClient(server('s1'))).resolves.toBeDefined();
	});

	it('disposeAll during a build leaves no warm client behind', async () => {
		const release = holdBuilds();
		const cache = createClientCache(baseConfig());
		const building = cache.getClient(server('s1'));
		await Promise.resolve();

		cache.disposeAll();
		release();
		await expect(building).rejects.toMatchObject({ code: 'ABORTED' });
		expect(cache.solveCacheStats().warmClients).toBe(0);
		expect(disposedSchedulers).toHaveLength(1);
	});
});

describe('createClientCache — X-Selva-Definition', () => {
	it('stamps the definition guid on the client headers when provided', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'), { definitionGuid: 'guid-123' });
		expect(createdConfigs[0].headers).toEqual({ 'X-Selva-Definition': 'guid-123' });
	});

	it('omits the header entirely when no guid is given', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'));
		expect(createdConfigs[0].headers).toBeUndefined();
	});

	it('stays the first definition on a warm client, since the header is fixed per client', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'), { definitionGuid: 'first' });
		await cache.getClient(server('s1'), { definitionGuid: 'second' });
		expect(createdConfigs).toHaveLength(1);
		expect(createdConfigs[0].headers).toEqual({ 'X-Selva-Definition': 'first' });
	});
});

describe('createClientCache — scheduler backpressure', () => {
	it('forwards non-zero queue bounds to the scheduler', async () => {
		const cache = createClientCache({ ...baseConfig(), maxQueueDepth: 12, queueWaitMs: 90_000 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].maxQueueDepth).toBe(12);
		expect(createdSchedulerOptions[0].queueWaitMs).toBe(90_000);
	});

	it('maps a 0 (disabled) queue bound to undefined so the scheduler stays unbounded', async () => {
		// The scheduler treats undefined as unbounded/no-deadline; passing 0 would
		// reject EVERY queued solve. Our `0 = off` convention must become undefined.
		const cache = createClientCache({ ...baseConfig(), maxQueueDepth: 0, queueWaitMs: 0 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].maxQueueDepth).toBeUndefined();
		expect(createdSchedulerOptions[0].queueWaitMs).toBeUndefined();
	});
});

describe('createClientCache — response size cap', () => {
	it('hands maxResponseBytes to the compute client', async () => {
		const cache = createClientCache({ ...baseConfig(), maxResponseBytes: 12_345 });
		await cache.getClient(server('s1'));
		expect(createdConfigs[0].maxResponseBytes).toBe(12_345);
	});
});

describe('createClientCache — L1 response cache byte budget', () => {
	it('forwards responseCacheMaxBytes as the scheduler cache maxBytes', async () => {
		const cache = createClientCache({ ...baseConfig(), responseCacheMaxBytes: 64 * 1024 * 1024 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].cache).toEqual({ maxBytes: 64 * 1024 * 1024 });
	});

	it('disables the L1 response cache entirely when the budget is 0', async () => {
		const cache = createClientCache({ ...baseConfig(), responseCacheMaxBytes: 0 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].cache).toBe(false);
	});
});

describe('createClientCache — client-level Server-Timing', () => {
	it('sets no onServerTiming when debug is off', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'));
		expect(createdConfigs[0].onServerTiming).toBeUndefined();
	});

	async function debugClient() {
		const lines: string[] = [];
		const cache = createClientCache({
			...baseConfig(),
			debug: true,
			onDebugLog: (m) => lines.push(m)
		});
		const entry = await cache.getClient(server('s1'));
		const timing = prop<(t: Record<string, unknown>) => void>(createdConfigs[0], 'onServerTiming');
		return { lines, entry, timing };
	}

	it('logs a miss with the phases Rhino reported', async () => {
		const { lines, timing } = await debugClient();
		timing({ decode: 0, solve: 100, encode: 3 });
		expect(lines.at(-1)).toContain('solve=100ms');
		expect(lines.at(-1)).toContain('miss');
	});

	it("logs a compute result-cache hit from the server's own verdict", async () => {
		const { lines, timing } = await debugClient();
		timing({ cacheHit: true });
		expect(lines.at(-1)).toContain('HIT');
	});

	it('names a scheduler cache hit and a miss on settle', async () => {
		const { lines, entry } = await debugClient();
		const scheduler = mockScheduler(entry);
		scheduler.settle({ status: 'success', fromCache: true, durationMs: 1 });
		expect(lines.at(-1)).toContain('HIT');

		scheduler.settle({ status: 'success', fromCache: false, durationMs: 1, response: {} });
		expect(lines.some((l) => l.includes('selva-cache') && l.includes('miss'))).toBe(true);
	});

	it('counts solver errors without logging their text, which can quote user input', async () => {
		const { lines, entry } = await debugClient();
		mockScheduler(entry).settle({
			status: 'success',
			durationMs: 1,
			response: { errors: ['customer SECRET', 'another'] }
		});
		expect(lines.join('\n')).toContain('2 GH error(s)');
		expect(lines.join('\n')).not.toContain('SECRET');
	});
});

// Each warm client owns a separate solve cache, so an operator-facing hit rate
// has to sum them — one server's numbers wouldn't describe the deployment.
describe('createClientCache — solveCacheStats', () => {
	/** Reach the mock scheduler's mutable stats for a warm client. */
	function statsOf(entry: { scheduler: unknown }) {
		return (entry.scheduler as { stats: Record<string, number> }).stats;
	}

	it('reports zeroes and no warm clients before anything is cached', () => {
		const cache = createClientCache(baseConfig());
		expect(cache.solveCacheStats()).toEqual({
			warmClients: 0,
			entries: 0,
			bytes: 0,
			hits: 0,
			misses: 0,
			evictions: 0
		});
	});

	it('sums counters across every warm client', async () => {
		const cache = createClientCache(baseConfig());
		const a = await cache.getClient(server('a'));
		const b = await cache.getClient(server('b'));

		Object.assign(statsOf(a), { entries: 2, bytes: 100, hits: 7, misses: 3, evictions: 1 });
		Object.assign(statsOf(b), { entries: 5, bytes: 250, hits: 1, misses: 9, evictions: 4 });

		expect(cache.solveCacheStats()).toEqual({
			warmClients: 2,
			entries: 7,
			bytes: 350,
			hits: 8,
			misses: 12,
			evictions: 5
		});
	});

	it('drops an evicted client’s numbers — the totals describe live caches only', async () => {
		const cache = createClientCache(baseConfig());
		const a = await cache.getClient(server('a'));
		Object.assign(statsOf(a), { entries: 2, bytes: 100, hits: 7, misses: 3, evictions: 1 });
		expect(cache.solveCacheStats().hits).toBe(7);

		cache.evict('a');
		expect(cache.solveCacheStats()).toMatchObject({ warmClients: 0, hits: 0 });
	});
});

describe('createClientCache — failed builds', () => {
	it('replays a recent failure verbatim instead of re-running the probe ladder', async () => {
		const original = new Error('rejected the liveness probe with HTTP 401');
		createFailure = original;
		const cache = createClientCache(baseConfig());

		await expect(cache.getClient(server('a'))).rejects.toBe(original);
		// The second click must not pay for another handshake.
		await expect(cache.getClient(server('a'))).rejects.toBe(original);
		expect(createCalls).toBe(1);
	});

	it('tries the handshake again once the remembered failure expires', async () => {
		vi.useFakeTimers();
		try {
			createFailure = new Error('down');
			const cache = createClientCache(baseConfig());
			await expect(cache.getClient(server('a'))).rejects.toThrow('down');

			createFailure = null;
			vi.advanceTimersByTime(5_001);
			await expect(cache.getClient(server('a'))).resolves.toBeDefined();
			expect(createCalls).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('two callers sharing a failing build both see the failure, from one handshake', async () => {
		const release = holdBuilds();
		createFailure = new Error('down');
		const cache = createClientCache(baseConfig());
		const a = cache.getClient(server('a'));
		const b = cache.getClient(server('a'));
		release();
		await expect(a).rejects.toThrow('down');
		await expect(b).rejects.toThrow('down');
		expect(createCalls).toBe(1);
	});

	it("does not let one server's failure block another", async () => {
		createFailure = new Error('down');
		const cache = createClientCache(baseConfig());
		await expect(cache.getClient(server('a'))).rejects.toThrow('down');

		createFailure = null;
		await expect(cache.getClient(server('b'))).resolves.toBeDefined();
	});

	it('evict clears the remembered failure so a config fix applies immediately', async () => {
		createFailure = new Error('down');
		const cache = createClientCache(baseConfig());
		await expect(cache.getClient(server('a'))).rejects.toThrow('down');

		// Operator corrected the URL/key: the reason for the last failure is gone.
		cache.evict('a');
		createFailure = null;
		await expect(cache.getClient(server('a'))).resolves.toBeDefined();
		expect(createCalls).toBe(2);
	});
});
