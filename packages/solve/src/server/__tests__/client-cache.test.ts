/**
 * Tests for `createClientCache` — the per-server warm-client LRU.
 *
 * `@selvajs/compute`'s `GrasshopperClient.create` does a real network preflight,
 * so we mock the module: `create` records the config it was called with and
 * returns a fake client whose `createScheduler` returns a disposable stub. That
 * lets us assert the cache's own behavior (id-keying, LRU eviction, evict,
 * disposeAll, the `X-Selva-Definition` header) without a live compute server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock @selvajs/compute -------------------------------------------------
//
// The recorded values are asserted on property-by-property, so they are loose records rather than
// the real config types: the point of the mock is that the cache passes values THROUGH untouched,
// and pinning the upstream shapes here would just couple these tests to `@selvajs/compute`.
//
// `unknown` rather than `any`: the few assertions that index into these need a cast, and `prop()`
// below does it in one place instead of the type opting out everywhere.
type Recorded = Record<string, unknown>;

/** Read a recorded property. The cast is the point of `Recorded` being `unknown`-valued. */
function prop<T = unknown>(record: Recorded | undefined, key: string): T {
	return record?.[key] as T;
}

const createdConfigs: Recorded[] = [];
const createdSchedulerOptions: Recorded[] = [];
const disposedSchedulers: { disposed: boolean }[] = [];

vi.mock('@selvajs/compute', () => {
	class GrasshopperClient {
		static async create(config: Recorded) {
			createdConfigs.push(config);
			return new GrasshopperClient(config);
		}
		constructor(public config: Recorded) {}
		createScheduler(options: Recorded) {
			createdSchedulerOptions.push(options);
			const scheduler = {
				disposed: false,
				dispose() {
					this.disposed = true;
					disposedSchedulers.push(this);
				}
			};
			return scheduler;
		}
	}
	return { GrasshopperClient, enableDebugLogging: vi.fn() };
});

import { createClientCache, serverIdentity } from '../client-cache.js';

function baseConfig() {
	return {
		maxSolveDurationMs: 30_000,
		maxConcurrentSolves: 4,
		maxQueueDepth: 0,
		queueWaitMs: 0,
		cachesolve: true,
		cacheerroredsolves: false,
		reuseServerDefinitionCache: true,
		responseCacheMaxBytes: 256 * 1024 * 1024,
		debug: false,
		debugVerbose: false
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
});

describe('createClientCache — keying', () => {
	it('keys on id: two calls for the same id build one client', async () => {
		const cache = createClientCache(baseConfig());
		const a = await cache.getClient(server('s1'));
		const b = await cache.getClient(server('s1'));
		expect(a).toBe(b);
		expect(createdConfigs).toHaveLength(1);
	});

	it('reuses the entry even when the URL/apiKey rotate under the same id', async () => {
		// The whole point of ADR 0004 D1: identity is the id, so a rotated URL is
		// the SAME entry (stale until evicted) — not a new client.
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
});

describe('createClientCache — LRU eviction', () => {
	it('evicts the least-recently-used entry past capacity and disposes its scheduler', async () => {
		const cache = createClientCache({ ...baseConfig(), maxCachedClients: 2 });
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

	it('evict accepts a ServerIdentity', async () => {
		const cache = createClientCache(baseConfig());
		await cache.getClient(server('s1'));
		cache.evict(serverIdentity({ id: 's1' }));
		expect(disposedSchedulers).toHaveLength(1);
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
});

describe('createClientCache — X-Selva-Definition (ADR 0004 D2)', () => {
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
});

describe('createClientCache — scheduler concurrency (audit B6)', () => {
	it('forwards maxConcurrentSolves as the scheduler maxConcurrent in queue mode', async () => {
		const cache = createClientCache({ ...baseConfig(), maxConcurrentSolves: 7 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions).toHaveLength(1);
		// Queue mode with NO maxConcurrent defaults to 1 in the scheduler,
		// serializing every solve on the server — the option must always be set.
		expect(createdSchedulerOptions[0].mode).toBe('queue');
		expect(createdSchedulerOptions[0].maxConcurrent).toBe(7);
	});
});

describe('createClientCache — scheduler backpressure (audit B7)', () => {
	it('forwards non-zero queue bounds to the scheduler', async () => {
		const cache = createClientCache({ ...baseConfig(), maxQueueDepth: 12, queueWaitMs: 90_000 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].maxQueueDepth).toBe(12);
		expect(createdSchedulerOptions[0].queueWaitMs).toBe(90_000);
	});

	it('maps a 0 (disabled) queue bound to undefined so the scheduler stays unbounded', async () => {
		// The scheduler treats undefined as unbounded/no-deadline; passing 0 would
		// shed EVERY queued solve. Our `0 = off` convention must become undefined.
		const cache = createClientCache({ ...baseConfig(), maxQueueDepth: 0, queueWaitMs: 0 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].maxQueueDepth).toBeUndefined();
		expect(createdSchedulerOptions[0].queueWaitMs).toBeUndefined();
	});
});

describe('createClientCache — L1 response cache byte budget (audit C2)', () => {
	it('forwards responseCacheMaxBytes as the scheduler cache maxBytes', async () => {
		const cache = createClientCache({ ...baseConfig(), responseCacheMaxBytes: 64 * 1024 * 1024 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].cache).toEqual({
			maxEntries: 20,
			ttlMs: 5 * 60_000,
			maxBytes: 64 * 1024 * 1024
		});
	});

	it('disables the L1 response cache entirely when the budget is 0', async () => {
		const cache = createClientCache({ ...baseConfig(), responseCacheMaxBytes: 0 });
		await cache.getClient(server('s1'));
		expect(createdSchedulerOptions[0].cache).toBe(false);
	});
});

describe('createClientCache — per-request telemetry sequence counters', () => {
	it('onServerTiming bumps rhinoTiming.seq on every write', async () => {
		const cache = createClientCache(baseConfig());
		const entry = await cache.getClient(server('s1'));
		expect(entry.rhinoTiming).toEqual({ last: null, seq: 0 });
		prop<(t: Record<string, number>) => void>(
			createdConfigs[0],
			'onServerTiming'
		)({ decode: 5, solve: 100, encode: 3 });
		expect(entry.rhinoTiming.seq).toBe(1);
		expect(entry.rhinoTiming.last).toEqual({ decode: 5, solve: 100, encode: 3 });
		prop<(t: Record<string, number>) => void>(
			createdConfigs[0],
			'onServerTiming'
		)({ decode: 1, solve: 2, encode: 3 });
		expect(entry.rhinoTiming.seq).toBe(2);
		expect(entry.rhinoTiming.last).toEqual({ decode: 1, solve: 2, encode: 3 });
	});

	it('onSettle bumps solveMeta.seq on every settle but writes last only on success', async () => {
		const cache = createClientCache(baseConfig());
		const entry = await cache.getClient(server('s1'));
		const onSettle = prop<(key: Record<string, unknown>, outcome: Record<string, unknown>) => void>(
			createdSchedulerOptions[0],
			'onSettle'
		);
		expect(entry.solveMeta).toEqual({ last: null, seq: 0 });

		onSettle(
			{ key: 'k' },
			{
				status: 'success',
				fromCache: false,
				definitionReuploaded: false,
				durationMs: 10,
				response: {}
			}
		);
		expect(entry.solveMeta.seq).toBe(1);
		expect(entry.solveMeta.last).toEqual({ fromCache: false, definitionReuploaded: false });

		// An error settle must still count toward seq (the attribution guard in
		// the pipeline needs to see ALL concurrent activity) without clobbering last.
		onSettle({ key: 'k' }, { status: 'error', error: new Error('x'), durationMs: 5 });
		expect(entry.solveMeta.seq).toBe(2);
		expect(entry.solveMeta.last).toEqual({ fromCache: false, definitionReuploaded: false });

		onSettle({ key: 'k' }, { status: 'success', fromCache: true, durationMs: 0, response: {} });
		expect(entry.solveMeta.seq).toBe(3);
		expect(entry.solveMeta.last).toEqual({ fromCache: true, definitionReuploaded: undefined });
	});
});

describe('serverIdentity', () => {
	it('derives identity from the id', () => {
		expect(serverIdentity({ id: 'abc' })).toBe('abc');
	});
});
