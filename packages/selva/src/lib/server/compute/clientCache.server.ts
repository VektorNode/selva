/**
 * App-side binding for the shared compute client cache. The cache itself —
 * one warm `GrasshopperClient` (+ `SolveScheduler`) per compute server, keyed
 * by the server's `id`, with an LRU bound — lives in `@selvajs/server`
 * (`createClientCache`, see ADR 0004). This module owns the single app-wide
 * instance, wired with the env-derived limits/flags, and adapts the app's
 * `ComputeServerConfig` to the cache's `ResolvedServer` shape.
 *
 * Identity is the server `id` (ADR 0004 D1). A rotated URL/apiKey keeps the same
 * key with stale connection details, so the config-write path MUST call
 * `evictComputeClient(id)` — see the admin/org compute PUT routes.
 */

import { createClientCache, type CachedClient } from '@selvajs/server/compute';
import { env } from '$env/dynamic/private';
import type { ComputeServerConfig } from '@selvajs/platform';
import {
	COMPUTE_CACHE_ERRORED_SOLVES,
	COMPUTE_MAX_CONCURRENT,
	COMPUTE_REUSE_DEFINITION_CACHE,
	COMPUTE_SERVER_CACHESOLVE,
	MAX_SOLVE_DURATION_MS
} from '$lib/server/computeLimits';

/** Concise cache/timing logs (Selva cache hits, server decode/solve/encode). */
export const COMPUTE_DEBUG = ['true', '1', 'yes'].includes(
	(env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase()
);
/**
 * VERBOSE lib-level logging: dumps the FULL solve request/response (incl. base64
 * geometry). Separate opt-in so the concise cache logs aren't drowned out.
 */
export const COMPUTE_DEBUG_VERBOSE = ['true', '1', 'yes'].includes(
	(env.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE ?? '').toLowerCase()
);

const cache = createClientCache({
	maxSolveDurationMs: MAX_SOLVE_DURATION_MS,
	maxConcurrentSolves: COMPUTE_MAX_CONCURRENT,
	cachesolve: COMPUTE_SERVER_CACHESOLVE,
	cacheerroredsolves: COMPUTE_CACHE_ERRORED_SOLVES,
	reuseServerDefinitionCache: COMPUTE_REUSE_DEFINITION_CACHE,
	debug: COMPUTE_DEBUG,
	debugVerbose: COMPUTE_DEBUG_VERBOSE,
	onDebugLog: (message) => console.log(message)
});

/**
 * Get (or create) the warm client + scheduler for a resolved compute server.
 * Callers pass the fully-resolved `ComputeServerConfig` (from
 * `resolveServerForOrg`); the cache keys on its `id`, so the same server always
 * hits the same entry regardless of which definition or path asked for it.
 *
 * `definitionGuid`, when passed, is stamped as `X-Selva-Definition` on this
 * client's outbound requests — routing/telemetry metadata for a future pool
 * (ADR 0004 D2), inert on a single-member server today.
 */
export function getClient(
	serverConfig: ComputeServerConfig,
	opts?: { definitionGuid?: string }
): Promise<CachedClient> {
	return cache.getClient(
		{ id: serverConfig.id, serverUrl: serverConfig.serverUrl, apiKey: serverConfig.apiKey },
		opts
	);
}

/**
 * Drop the warm client for a server whose config just changed (URL/key rotation
 * or deletion via /admin/compute or /api/org/compute). Keyed on `id`, the entry
 * would otherwise keep stale connection details until it aged out of the LRU —
 * so config writes evict explicitly (ADR 0004 Consequences).
 */
export function evictComputeClient(id: string): void {
	cache.evict(id);
}

export type { CachedClient };
