import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundedTtlCache } from '../bounded-ttl-cache.js';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createBoundedTtlCache', () => {
	it('returns a stored value before its TTL elapses', () => {
		const cache = createBoundedTtlCache<string>({ maxEntries: 10 });
		cache.set('a', 'value', 1000);
		vi.advanceTimersByTime(999);
		expect(cache.get('a')).toBe('value');
	});

	it('treats an entry as absent once its TTL elapses', () => {
		const cache = createBoundedTtlCache<string>({ maxEntries: 10 });
		cache.set('a', 'value', 1000);
		vi.advanceTimersByTime(1000);
		expect(cache.get('a')).toBeUndefined();
	});

	it('drops the expired entry on read rather than retaining it', () => {
		const cache = createBoundedTtlCache<string>({ maxEntries: 10 });
		cache.set('a', 'value', 1000);
		vi.advanceTimersByTime(1000);
		cache.get('a');
		expect(cache.size()).toBe(0);
	});

	it('gives each key its own TTL', () => {
		const cache = createBoundedTtlCache<string>({ maxEntries: 10 });
		cache.set('short', 'a', 100);
		cache.set('long', 'b', 10_000);
		vi.advanceTimersByTime(100);
		expect(cache.get('short')).toBeUndefined();
		expect(cache.get('long')).toBe('b');
	});

	it('never exceeds maxEntries', () => {
		const cache = createBoundedTtlCache<number>({ maxEntries: 3 });
		for (let i = 0; i < 20; i++) cache.set(`k${i}`, i, 60_000);
		expect(cache.size()).toBeLessThanOrEqual(3);
	});

	// Republishing strands old-version keys, so a cache keyed by versionId would
	// grow without limit.
	it('reclaims expired entries before evicting live ones', () => {
		const cache = createBoundedTtlCache<string>({ maxEntries: 3 });
		cache.set('old1', 'x', 100);
		cache.set('old2', 'x', 100);
		vi.advanceTimersByTime(100);
		cache.set('fresh', 'y', 60_000);
		cache.set('fresh2', 'z', 60_000);
		expect(cache.get('fresh')).toBe('y');
		expect(cache.get('fresh2')).toBe('z');
	});

	it('evicts oldest-inserted when every entry is still live', () => {
		const cache = createBoundedTtlCache<number>({ maxEntries: 2 });
		cache.set('a', 1, 60_000);
		cache.set('b', 2, 60_000);
		cache.set('c', 3, 60_000);
		expect(cache.get('a')).toBeUndefined();
		expect(cache.get('c')).toBe(3);
	});

	it('refreshes insertion order on re-set so a hot key is not evicted first', () => {
		const cache = createBoundedTtlCache<number>({ maxEntries: 2 });
		cache.set('a', 1, 60_000);
		cache.set('b', 2, 60_000);
		cache.set('a', 10, 60_000); // 'a' becomes newest; 'b' is now oldest
		cache.set('c', 3, 60_000);
		expect(cache.get('a')).toBe(10);
		expect(cache.get('b')).toBeUndefined();
	});

	it('delete removes an entry', () => {
		const cache = createBoundedTtlCache<string>({ maxEntries: 10 });
		cache.set('a', 'value', 60_000);
		cache.delete('a');
		expect(cache.get('a')).toBeUndefined();
	});

	it('clear empties the cache', () => {
		const cache = createBoundedTtlCache<string>({ maxEntries: 10 });
		cache.set('a', '1', 60_000);
		cache.set('b', '2', 60_000);
		cache.clear();
		expect(cache.size()).toBe(0);
	});
});
