/**
 * In-process cache of `.gh` definition bytes, keyed by immutable **version id**.
 *
 * The solve path used to eagerly `storage.get(fileKey)` on every request — moving
 * multi-MB definition bytes off disk/S3 into memory before the scheduler could
 * decide it didn't need them (the compute server already holds the definition via
 * the pointer/`reuseServerDefinitionCache` fast path). This cache turns that eager
 * read into a lazy `DefinitionRef.load()`: the scheduler calls `load()` ONLY when
 * an upload is unavoidable, and even then a warm entry serves the bytes without
 * touching storage. A pointer-known re-solve therefore moves ZERO definition bytes.
 *
 * Keying discipline (the whole reason this module exists):
 *   - The key is the **version id**, an immutable UUID — never a `fileKey`, which
 *     a delete-latest-then-reupload can REUSE for different content (see the
 *     monotonic-version-number fix). A reused key would serve one version's bytes
 *     for another: silent cache poisoning with no diagnostic. Callers pass
 *     `version.id`, and the returned `DefinitionRef.key` is that same id, so the
 *     scheduler's own result/pointer cache keys on the same immutable identity.
 *
 * Eviction:
 *   - LRU by **total byte budget**, not entry count — definitions range from tens
 *     of KB to hundreds of MB, so an entry-count cap would either pin gigabytes or
 *     evict uselessly. `COMPUTE_DEFINITION_BYTE_CACHE_MB` sets the budget; `0`
 *     disables the cache (every `getOrLoad` calls `load` and caches nothing).
 *   - No TTL: version ids are immutable, so a cached entry can never go stale.
 *   - An entry larger than the whole budget is served but never retained (caching
 *     it would immediately evict everything including itself).
 */

/**
 * Per-`getOrLoad` outcome, observable AFTER the scheduler has (or hasn't) called
 * `load()`. Lets the solve pipeline emit a `def_bytes` Server-Timing verdict:
 *   - `load` never invoked  → the scheduler served a pointer-known solve without
 *     bytes (`skipped`);
 *   - `load` invoked, `fromCache` true  → warm byte-cache entry (`hit`);
 *   - `load` invoked, `fromCache` false → fell through to the loader (`miss`).
 */
export interface ByteRefOutcome {
	/** True once `load()` has been called at least once on this ref. */
	loaded: boolean;
	/** When `loaded`, whether the bytes came from a warm cache entry. */
	fromCache: boolean;
}

/** A definition reference shaped for `@selvajs/compute`'s `DefinitionRef`. */
export interface ByteCacheRef {
	/** Immutable identity (a version UUID). Keys the scheduler's caches too. */
	key: string;
	/** Materialize the bytes — served from cache when warm, else via the loader. */
	load: () => Promise<Uint8Array>;
	/** Mutable outcome of this ref's `load()` (see {@link ByteRefOutcome}). */
	outcome: ByteRefOutcome;
}

/** Hit/miss/eviction counters for observability (Server-Timing, admin debug). */
export interface ByteCacheStats {
	/** `load()` served from a warm entry (no loader call). */
	hits: number;
	/** `load()` fell through to the loader (cold key, or caching disabled). */
	misses: number;
	/** Entries dropped by the byte-budget LRU. */
	evictions: number;
	/** Current retained entry count. */
	entries: number;
	/** Current retained bytes. */
	bytes: number;
}

export interface DefinitionByteCache {
	/**
	 * Return a `DefinitionRef` whose `load()` serves `versionId`'s bytes from the
	 * cache when warm, otherwise calls `load` (and caches the result). The
	 * `DefinitionRef` is cheap to build and moves no bytes until `load()` runs —
	 * so handing it to the scheduler for a pointer-known solve costs nothing.
	 */
	getOrLoad(versionId: string, load: () => Promise<Uint8Array>): ByteCacheRef;
	/** Snapshot of the counters (see {@link ByteCacheStats}). */
	stats(): ByteCacheStats;
	/** Drop everything (test seam / eviction on definition delete if ever needed). */
	clear(): void;
}

interface Entry {
	bytes: Uint8Array;
}

/**
 * Build a definition-byte cache with a total-byte LRU budget.
 *
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
		// Evict least-recently-used (first in insertion order) until within budget.
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
		// An entry bigger than the whole budget is never retained — caching it would
		// evict everything (including itself) on the next `evictToFit`. Serve it
		// through, cache nothing.
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
