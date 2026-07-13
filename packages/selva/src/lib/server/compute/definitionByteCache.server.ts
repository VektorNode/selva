/**
 * App-wide binding for the definition-byte cache. The cache — an in-process,
 * total-byte-budget LRU keyed on immutable version id — lives in `@selvajs/server`
 * (`createDefinitionByteCache`). This module owns the single instance, sized from
 * the env-derived budget, so both hot paths that read `.gh` bytes share it:
 *
 *   - the solve route hands the scheduler a `DefinitionRef` from `getOrLoad`, so a
 *     pointer-known solve never touches storage and a warm entry serves the rest;
 *   - the render/IO path (getIO, schema re-extraction) loads real bytes through
 *     the same cache, so a page view right after a solve reuses the warm entry.
 *
 * Keying on version id (never `fileKey`) is the safety invariant — see the module
 * doc in `definition-byte-cache.ts`.
 */

import { createDefinitionByteCache } from '@selvajs/server/compute';
import { COMPUTE_DEFINITION_BYTE_CACHE_BYTES } from '$lib/server/computeLimits';

const cache = createDefinitionByteCache(COMPUTE_DEFINITION_BYTE_CACHE_BYTES);

/**
 * Return a `DefinitionRef` (identity + lazy loader) for a version's `.gh` bytes.
 * The scheduler calls `load()` only when an upload is unavoidable; when it does,
 * a warm cache entry serves the bytes without calling `load`. Pass the immutable
 * `version.id` as the key and the storage read as the loader.
 */
export function definitionRef(versionId: string, load: () => Promise<Uint8Array>) {
	return cache.getOrLoad(versionId, load);
}

/**
 * Materialize a version's bytes through the cache (render/IO path, which needs
 * the actual bytes now). Equivalent to `definitionRef(...).load()`.
 */
export function loadDefinitionBytes(
	versionId: string,
	load: () => Promise<Uint8Array>
): Promise<Uint8Array> {
	return cache.getOrLoad(versionId, load).load();
}

/** Cache counters (hits/misses/evictions/entries/bytes) for admin/debug surfaces. */
export function definitionByteCacheStats() {
	return cache.stats();
}
