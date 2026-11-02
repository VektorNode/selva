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

import { raceAbort } from '../shared/abort.js';

/**
 * Per-`getOrLoad` outcome, observable after the scheduler has (or hasn't)
 * called `load()` — lets the solve pipeline emit a `def_bytes` Server-Timing
 * verdict (`skipped` / `hit` / `miss`).
 */
export interface ByteRefOutcome {
	loaded: boolean;
	fromCache: boolean;
}

/** A definition reference shaped for `@selvajs/compute`'s `DefinitionRef`. */
export interface ByteCacheRef {
	key: string;
	load: (signal?: AbortSignal) => Promise<Uint8Array>;
	outcome: ByteRefOutcome;
}

export interface ByteCacheStats {
	hits: number;
	misses: number;
	evictions: number;
	entries: number;
	bytes: number;
}

export interface DefinitionByteCache {
	/** `load` gets a signal that fires once every caller waiting on this read has gone. */
	getOrLoad(versionId: string, load: (signal: AbortSignal) => Promise<Uint8Array>): ByteCacheRef;
	stats(): ByteCacheStats;
	clear(): void;
}

/** A `ByteCacheRef` carries `outcome`, which a plain `DefinitionRef` never has. */
export function isByteCacheRef(source: unknown): source is ByteCacheRef {
	return typeof source === 'object' && source !== null && 'outcome' in source;
}

/** One storage read, shared by every caller that misses while it runs. */
interface Loading {
	promise: Promise<Uint8Array>;
	controller: AbortController;
	waiters: number;
}

/**
 * @param maxBytes total retained-byte budget; `0` (or negative) disables caching
 *   entirely — every `load()` calls the loader and nothing is retained.
 */
export function createDefinitionByteCache(maxBytes: number): DefinitionByteCache {
	const budget = Math.max(0, Math.floor(maxBytes));
	// Map iteration order is insertion order, so it doubles as LRU order:
	// re-inserting a key on access moves it to the most-recently-used end.
	const cache = new Map<string, Uint8Array>();
	const loading = new Map<string, Loading>();
	let retainedBytes = 0;
	const stats = { hits: 0, misses: 0, evictions: 0 };

	function evictToFit(): void {
		for (const [key, bytes] of cache) {
			if (retainedBytes <= budget) break;
			cache.delete(key);
			retainedBytes -= bytes.byteLength;
			stats.evictions += 1;
		}
	}

	function store(key: string, bytes: Uint8Array): void {
		if (budget === 0) return;
		// Caching an entry bigger than the budget would evict everything
		// (including itself) on the next evictToFit — serve it, cache nothing.
		if (bytes.byteLength > budget) return;
		cache.set(key, bytes);
		retainedBytes += bytes.byteLength;
		evictToFit();
	}

	function startLoad(key: string, load: (signal: AbortSignal) => Promise<Uint8Array>): Loading {
		const controller = new AbortController();
		const entry: Loading = {
			controller,
			waiters: 0,
			promise: (async () => {
				const bytes = await load(controller.signal);
				store(key, bytes);
				return bytes;
			})().finally(() => {
				if (loading.get(key) === entry) loading.delete(key);
			})
		};
		loading.set(key, entry);
		return entry;
	}

	/**
	 * A caller gone stops waiting, but the read runs on for whoever else is on it. A caller with no
	 * signal can't leave, so it stays counted and the read is never aborted under it.
	 */
	async function wait(entry: Loading, signal?: AbortSignal): Promise<Uint8Array> {
		entry.waiters += 1;
		if (!signal) return entry.promise;
		try {
			return await raceAbort(entry.promise, signal);
		} finally {
			entry.waiters -= 1;
			if (entry.waiters === 0 && signal.aborted) entry.controller.abort();
		}
	}

	return {
		getOrLoad(versionId, load) {
			const outcome: ByteRefOutcome = { loaded: false, fromCache: false };
			return {
				key: versionId,
				outcome,
				load: async function read(signal): Promise<Uint8Array> {
					outcome.loaded = true;
					const hit = cache.get(versionId);
					if (hit) {
						cache.delete(versionId);
						cache.set(versionId, hit);
						stats.hits += 1;
						outcome.fromCache = true;
						return hit;
					}
					const running = loading.get(versionId);
					if (running?.controller.signal.aborted) {
						// Abandoned, and a store that ignores its signal may never finish. Waiting it out
						// rather than starting a second read keeps a hung store to one read per version.
						const woundDown = running.promise.then(
							() => undefined,
							() => undefined
						);
						await (signal ? raceAbort(woundDown, signal) : woundDown);
						return read(signal);
					}
					if (running) {
						stats.hits += 1;
						outcome.fromCache = true;
						return wait(running, signal);
					}
					stats.misses += 1;
					return wait(startLoad(versionId, load), signal);
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
