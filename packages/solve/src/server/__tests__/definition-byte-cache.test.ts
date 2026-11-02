import { describe, it, expect, vi } from 'vitest';
import { createDefinitionByteCache } from '../definition-byte-cache.js';

/** A `Uint8Array` of `n` bytes filled with a marker so equality is checkable. */
function bytes(n: number, marker = 0): Uint8Array {
	return new Uint8Array(n).fill(marker);
}

/** A storage read the test finishes by hand. */
function hungRead(result = bytes(16)) {
	let seen: AbortSignal | undefined;
	let finish!: () => void;
	const done = new Promise<Uint8Array>((resolve) => (finish = () => resolve(result)));
	const load = vi.fn((signal: AbortSignal) => {
		seen = signal;
		return done;
	});
	return { load, finish, signal: () => seen };
}

describe('createDefinitionByteCache', () => {
	it('serves a warm entry without re-invoking the loader, and reports miss then hit', async () => {
		const cache = createDefinitionByteCache(10 * 1024 * 1024);
		const load = vi.fn(async () => bytes(1024, 7));

		const refMiss = cache.getOrLoad('v-1', load);
		const first = await refMiss.load();
		expect(refMiss.outcome).toEqual({ loaded: true, fromCache: false });

		const refHit = cache.getOrLoad('v-1', load);
		const second = await refHit.load();
		expect(refHit.outcome).toEqual({ loaded: true, fromCache: true });

		expect(first).toEqual(second);
		expect(load).toHaveBeenCalledTimes(1);
		expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1, bytes: 1024 });
	});

	it("a ref whose load() is never called leaves outcome.loaded false (the 'skipped' verdict)", () => {
		const cache = createDefinitionByteCache(10 * 1024 * 1024);
		const ref = cache.getOrLoad('v-1', async () => bytes(1));
		expect(ref.outcome).toEqual({ loaded: false, fromCache: false });
	});

	it('evicts least-recently-used entries when the byte budget is exceeded', async () => {
		// Budget holds ~2 of these 1 KB entries.
		const cache = createDefinitionByteCache(2 * 1024);
		const load = (marker: number) => async () => bytes(1024, marker);

		await cache.getOrLoad('a', load(1)).load();
		await cache.getOrLoad('b', load(2)).load();
		await cache.getOrLoad('a', load(1)).load(); // touch 'a' so 'b' becomes the LRU victim
		await cache.getOrLoad('c', load(3)).load(); // insert c → evicts b

		expect(cache.stats().entries).toBe(2);
		expect(cache.stats().evictions).toBe(1);
		expect(cache.stats().bytes).toBe(2 * 1024);

		// Check 'a' before re-loading 'b': bringing 'b' back would itself evict 'a'
		// under this 2-entry budget, so order matters.
		const aLoad = vi.fn(load(1));
		await cache.getOrLoad('a', aLoad).load();
		expect(aLoad).toHaveBeenCalledTimes(0);

		const bLoad = vi.fn(load(2));
		await cache.getOrLoad('b', bLoad).load();
		expect(bLoad).toHaveBeenCalledTimes(1);
	});

	it('never retains an entry larger than the whole budget (serves through, caches nothing)', async () => {
		const cache = createDefinitionByteCache(1024);
		const load = vi.fn(async () => bytes(4096));

		const out = await cache.getOrLoad('big', load).load();
		expect(out.byteLength).toBe(4096);
		expect(cache.stats().entries).toBe(0);
		expect(cache.stats().bytes).toBe(0);

		await cache.getOrLoad('big', load).load();
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('budget 0 disables caching entirely (every load hits the loader, nothing retained)', async () => {
		const cache = createDefinitionByteCache(0);
		const load = vi.fn(async () => bytes(16));

		const ref1 = cache.getOrLoad('v-1', load);
		await ref1.load();
		await cache.getOrLoad('v-1', load).load();

		expect(load).toHaveBeenCalledTimes(2);
		expect(cache.stats().entries).toBe(0);
		expect(cache.stats().bytes).toBe(0);
		expect(ref1.outcome).toEqual({ loaded: true, fromCache: false });
	});

	it('clear empties the cache and its byte count', async () => {
		const cache = createDefinitionByteCache(10 * 1024 * 1024);
		await cache.getOrLoad('v-1', async () => bytes(1024)).load();
		cache.clear();
		expect(cache.stats().bytes).toBe(0);
		expect(cache.stats().entries).toBe(0);
	});
});

describe('concurrent misses', () => {
	it('share one storage read', async () => {
		const cache = createDefinitionByteCache(1024 * 1024);
		const read = hungRead(bytes(1000));
		const refs = Array.from({ length: 8 }, () => cache.getOrLoad('v', read.load));
		const loads = refs.map((ref) => ref.load());
		read.finish();

		const all = await Promise.all(loads);
		expect(read.load).toHaveBeenCalledTimes(1);
		expect(new Set(all).size).toBe(1);
		expect(cache.stats()).toMatchObject({ misses: 1, hits: 7, bytes: 1000 });
	});

	it('counts a joiner as a hit: it read nothing from storage', async () => {
		const cache = createDefinitionByteCache(1024);
		const read = hungRead();
		const first = cache.getOrLoad('v', read.load);
		const joiner = cache.getOrLoad('v', read.load);
		const loads = [first.load(), joiner.load()];
		read.finish();
		await Promise.all(loads);
		expect(joiner.outcome.fromCache).toBe(true);
		expect(first.outcome.fromCache).toBe(false);
	});

	it('a failed read fails its callers and leaves nothing behind', async () => {
		const cache = createDefinitionByteCache(1024);
		const failing = vi.fn(async () => {
			throw new Error('storage down');
		});
		await expect(cache.getOrLoad('v', failing).load()).rejects.toThrow('storage down');
		await expect(cache.getOrLoad('v', async () => bytes(4)).load()).resolves.toHaveLength(4);
	});
});

describe('a caller giving up on a read', () => {
	it('stops waiting at once, even when storage ignores the signal', async () => {
		const cache = createDefinitionByteCache(1024);
		const read = hungRead();
		const caller = new AbortController();
		const load = cache.getOrLoad('v', read.load).load(caller.signal);
		caller.abort(new Error('deadline'));
		await expect(load).rejects.toThrow('deadline');
	});

	it('hands the loader a signal that fires', async () => {
		const cache = createDefinitionByteCache(1024);
		const read = hungRead();
		const caller = new AbortController();
		const load = cache.getOrLoad('v', read.load).load(caller.signal);
		await Promise.resolve();
		caller.abort();
		await load.catch(() => {});
		expect(read.signal()?.aborted).toBe(true);
	});

	it('leaves the read running for the others on it', async () => {
		const cache = createDefinitionByteCache(1024);
		const read = hungRead();
		const leaver = new AbortController();
		const stayer = new AbortController();
		const gone = cache.getOrLoad('v', read.load).load(leaver.signal);
		const kept = cache.getOrLoad('v', read.load).load(stayer.signal);
		await Promise.resolve();
		leaver.abort();
		await gone.catch(() => {});
		expect(read.signal()?.aborted).toBe(false);
		read.finish();
		await expect(kept).resolves.toHaveLength(16);
	});

	it('a caller after everyone left reads again once the abandoned read has failed', async () => {
		const cache = createDefinitionByteCache(1024);
		const abandoned = vi.fn(
			(signal: AbortSignal) =>
				new Promise<Uint8Array>((_, reject) => {
					signal.addEventListener('abort', () => reject(new Error('stopped')));
				})
		);
		const caller = new AbortController();
		const gone = cache.getOrLoad('v', abandoned).load(caller.signal);
		await Promise.resolve();
		caller.abort();
		await gone.catch(() => {});

		const fresh = vi.fn(async () => bytes(8));
		await expect(cache.getOrLoad('v', fresh).load()).resolves.toHaveLength(8);
		expect(fresh).toHaveBeenCalledTimes(1);
	});

	it('a retry against a hung store adds no second read', async () => {
		const cache = createDefinitionByteCache(1024);
		const read = hungRead();
		const first = new AbortController();
		const gone = cache.getOrLoad('v', read.load).load(first.signal);
		await Promise.resolve();
		first.abort();
		await gone.catch(() => {});

		const second = new AbortController();
		const retry = vi.fn(async () => bytes(8));
		const retried = cache.getOrLoad('v', retry).load(second.signal);
		second.abort();

		await expect(retried).rejects.toBeDefined();
		expect(retry).not.toHaveBeenCalled();
	});

	it('never aborts a read under a caller that has no signal to leave with', async () => {
		const cache = createDefinitionByteCache(1024);
		const read = hungRead();
		const plain = cache.getOrLoad('v', read.load).load();
		const leaving = new AbortController();
		const gone = cache.getOrLoad('v', read.load).load(leaving.signal);
		await Promise.resolve();
		leaving.abort();
		await gone.catch(() => {});

		expect(read.signal()?.aborted).toBe(false);
		read.finish();
		await expect(plain).resolves.toHaveLength(16);
	});

	it('a retry waiting on an abandoned read is served what that read lands', async () => {
		const cache = createDefinitionByteCache(10_000);
		const read = hungRead(bytes(100));
		const caller = new AbortController();
		const gone = cache.getOrLoad('v', read.load).load(caller.signal);
		await Promise.resolve();
		caller.abort();
		await gone.catch(() => {});

		const retry = vi.fn(async () => bytes(1));
		const retried = cache.getOrLoad('v', retry).load();
		read.finish();

		await expect(retried).resolves.toHaveLength(100);
		expect(retry).not.toHaveBeenCalled();
		expect(cache.stats()).toMatchObject({ entries: 1, bytes: 100 });
	});
});
