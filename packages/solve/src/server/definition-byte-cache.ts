/**
 * In-process cache of `.gh` definition bytes, keyed by immutable **version id**.
 *
 * Turns an eager `storage.get(fileKey)` on every solve request into a lazy
 * `DefinitionRef.load()`: the scheduler calls `load()` only when an upload is
 * unavoidable (a pointer-known re-solve never touches storage or this cache).
 *
 * The key MUST be the version id, never a `fileKey` — a delete-latest-then-
 * reupload can reuse a `fileKey` for different content, which would silently
 * serve one version's bytes for another with no diagnostic. Callers pass
 * `version.id`, and the returned `DefinitionRef.key` is that same id, so the
 * scheduler's own result/pointer cache keys on the same immutable identity.
 *
 * Eviction is LRU by total byte budget, not entry count — definitions range
 * from tens of KB to hundreds of MB, so a count cap would either pin
 * gigabytes or evict uselessly. `COMPUTE_DEFINITION_CACHE_MB` sets the
 * budget (see `createDefinitionByteCache`). No TTL: version ids are
 * immutable, so a cached entry can never go stale. An entry larger than the
 * whole budget is served but never retained.
 */

/**
 * Per-`getOrLoad` outcome, observable after the scheduler has (or hasn't)
 * called `load()` — lets the solve pipeline emit a `def_bytes` Server-Timing
 * verdict (`skipped` / `hit` / `miss`).
 */
export interface ByteRefOutcome {
	loaded: boolean;
	/** When `loaded`, whether the bytes came from a warm cache entry. */
	fromCache: boolean;
}

/** A definition reference shaped for `@selvajs/compute`'s `DefinitionRef`. */
export interface ByteCacheRef {
	key: string;
	load: () => Promise<Uint8Array>;
	outcome: ByteRefOutcome;
}

/** Hit/miss/eviction counters for observability (Server-Timing, admin debug). */
export interface ByteCacheStats {
	hits: number;
	misses: number;
	/** Entries dropped by the byte-budget LRU. */
	evictions: number;
	entries: number;
	bytes: number;
}

export interface DefinitionByteCache {
	/**
	 * `DefinitionRef` whose `load()` serves `versionId`'s bytes from the cache
	 * when warm, otherwise calls `load` and caches the result. Cheap to build
	 * and moves no bytes until `load()` runs.
	 */
	getOrLoad(versionId: string, load: () => Promise<Uint8Array>): ByteCacheRef;
	stats(): ByteCacheStats;
	/** Test seam / eviction on definition delete if ever needed. */
	clear(): void;
}

interface Entry {
	bytes: Uint8Array;
}

/**
 * @param maxBytes total retained-byte budget; `0` (or negative) disables caching
 *   entirely — every `load()` calls the loader and nothing is retained.
 */
export function createDefinitionByteCache(maxBytes: number): DefinitionByteCache {
	const budget = Math.max(0, Math.floor(maxBytes));
	// Map preserves insertion order → iteration order IS LRU order; re-inserting
	// on access moves an entry to the most-recently-used (last) position.
	const cache = new Map<string, Entry>();
	let retainedBytes = 0;
	const stats = { hits: 0, misses: 0, evictions: 0 };

	function touch(key: string, entry: Entry): void {
		cache.delete(key);
		cache.set(key, entry);
	}

	function evictToFit(): void {
		while (retainedBytes > budget && cache.size > 0) {
			const oldestKey = cache.keys().next().value as string;
			const oldest = cache.get(oldestKey)!;
			cache.delete(oldestKey);
			retainedBytes -= oldest.bytes.byteLength;
			stats.evictions += 1;
		}
	}

	function store(key: string, bytes: Uint8Array): void {
		if (budget === 0) return;
		// Caching an entry bigger than the budget would evict everything
		// (including itself) on the next evictToFit — serve it, cache nothing.
		if (bytes.byteLength > budget) return;
		const existing = cache.get(key);
		if (existing) retainedBytes -= existing.bytes.byteLength;
		cache.set(key, { bytes });
		retainedBytes += bytes.byteLength;
		evictToFit();
	}

	return {
		getOrLoad(versionId, load) {
			const outcome: ByteRefOutcome = { loaded: false, fromCache: false };
			return {
				key: versionId,
				outcome,
				load: async () => {
					const hit = cache.get(versionId);
					if (hit) {
						touch(versionId, hit);
						stats.hits += 1;
						outcome.loaded = true;
						outcome.fromCache = true;
						return hit.bytes;
					}
					stats.misses += 1;
					outcome.loaded = true;
					outcome.fromCache = false;
					const bytes = await load();
					store(versionId, bytes);
					return bytes;
				}
			};
		},
		stats() {
			return {
				hits: stats.hits,
				misses: stats.misses,
				evictions: stats.evictions,
				entries: cache.size,
				bytes: retainedBytes
			};
		},
		clear() {
			cache.clear();
			retainedBytes = 0;
		}
	};
}
