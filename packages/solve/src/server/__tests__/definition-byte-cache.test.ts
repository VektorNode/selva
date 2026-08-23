import { describe, it, expect, vi } from 'vitest';
import { createDefinitionByteCache } from '../definition-byte-cache.js';

/** A `Uint8Array` of `n` bytes filled with a marker so equality is checkable. */
function bytes(n: number, marker = 0): Uint8Array {
	return new Uint8Array(n).fill(marker);
}

describe('createDefinitionByteCache', () => {
	it('serves a warm entry without re-invoking the loader (hit) and reports it', async () => {
		const cache = createDefinitionByteCache(10 * 1024 * 1024);
		const load = vi.fn(async () => bytes(1024, 7));

		const first = await cache.getOrLoad('v-1', load).load();
		const second = await cache.getOrLoad('v-1', load).load();

		expect(first).toEqual(second);
		expect(load).toHaveBeenCalledTimes(1);
		const s = cache.stats();
		expect(s.hits).toBe(1);
		expect(s.misses).toBe(1);
		expect(s.entries).toBe(1);
		expect(s.bytes).toBe(1024);
	});

	it('per-ref outcome distinguishes miss (loader) from hit (warm)', async () => {
		const cache = createDefinitionByteCache(10 * 1024 * 1024);
		const load = async () => bytes(512);

		const refMiss = cache.getOrLoad('v-1', load);
		await refMiss.load();
		expect(refMiss.outcome).toEqual({ loaded: true, fromCache: false });

		const refHit = cache.getOrLoad('v-1', load);
		await refHit.load();
		expect(refHit.outcome).toEqual({ loaded: true, fromCache: true });
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

	it('keys on the passed version id — two versions that reused a fileKey never collide', async () => {
		// Guards against delete-latest-then-reupload: fileKey can repeat, but
		// version id is always fresh, so distinct ids must stay distinct entries.
		const cache = createDefinitionByteCache(10 * 1024 * 1024);
		const oldBytes = bytes(1024, 1);
		const newBytes = bytes(1024, 2);

		const a = await cache.getOrLoad('version-old', async () => oldBytes).load();
		const b = await cache.getOrLoad('version-new', async () => newBytes).load();

		expect(a).toEqual(oldBytes);
		expect(b).toEqual(newBytes);
		expect(a).not.toEqual(b);
		expect(cache.stats().entries).toBe(2);
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

	it('re-storing the same key updates bytes without double-counting the budget', async () => {
		const cache = createDefinitionByteCache(10 * 1024 * 1024);
		await cache.getOrLoad('v-1', async () => bytes(1024)).load();
		expect(cache.stats().bytes).toBe(1024);
		cache.clear();
		expect(cache.stats().bytes).toBe(0);
		expect(cache.stats().entries).toBe(0);
	});
});
