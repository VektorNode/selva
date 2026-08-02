/**
 * App-side binding for the shared compute client cache. The cache itself —
 * one warm `GrasshopperClient` (+ `SolveScheduler`) per compute server, keyed
 * by the server's `id`, with an LRU bound — lives in `@selvajs/solve/server`
 * (`createClientCache`, see ADR 0004). This module owns the single app-wide
 * instance, wired with the env-derived limits/flags, and adapts the app's
 * `ComputeServerConfig` to the cache's `ResolvedServer` shape.
 *
 * Identity is the server `id` (ADR 0004 D1). A rotated URL/apiKey keeps the same
 * key with stale connection details, so the config-write path MUST call
 * `evictComputeClient(id)` — see the admin/org compute PUT routes.
 */

import { createClientCache, type CachedClient } from '@selvajs/solve/server';
import { env } from '$env/dynamic/private';
import { getLogger } from '$lib/server/providers.server';
import type { ComputeServerConfig } from '@selvajs/platform';
import {
	COMPUTE_CACHE_ERRORED_SOLVES,
	COMPUTE_MAX_CONCURRENT,
	COMPUTE_MAX_CONCURRENT_IS_DEFAULT,
	COMPUTE_MAX_QUEUE_DEPTH,
	COMPUTE_QUEUE_WAIT_MS,
	COMPUTE_SOLVE_CACHE_BYTES,
	COMPUTE_REUSE_DEFINITION_CACHE,
	COMPUTE_SERVER_CACHESOLVE,
	MAX_SOLVE_DURATION_MS
} from '$lib/server/computeLimits';

/**
 * `SELVA_FLAG_COMPUTE_DEBUG` is a three-way knob, not a boolean: `off` (default),
 * `on` (concise cache/timing logs), or `verbose` (adds FULL lib-level request/
 * response dumps, incl. base64 geometry). `verbose` implies `on` — there is no
 * way to get the verbose dump without the concise logs too.
 *
 * `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE` merged into this var. Still honoured for
 * one minor version so an operator's existing `.env` degrades to a warning,
 * not a silent loss of the verbose logging they asked for.
 */
const COMPUTE_DEBUG_MODE = (() => {
	const raw = (env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase();
	if (raw === 'verbose') return 'verbose';
	const on = ['true', '1', 'yes', 'on'].includes(raw);

	// Merged in 4.8; drop this shim (and the oldVerbose block) one minor version on.
	const oldVerbose = ['true', '1', 'yes'].includes(
		(env.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE ?? '').toLowerCase()
	);
	if (oldVerbose) {
		getLogger().warn('Deprecated env var: rename it', {
			component: 'selva',
			envVar: 'SELVA_FLAG_COMPUTE_DEBUG_VERBOSE',
			renamedTo: 'SELVA_FLAG_COMPUTE_DEBUG=verbose'
		});
		return 'verbose';
	}

	return on ? 'on' : 'off';
})();

/** Concise cache/timing logs (Selva cache hits, server decode/solve/encode). */
export const COMPUTE_DEBUG = COMPUTE_DEBUG_MODE !== 'off';
/** VERBOSE lib-level logging: dumps the FULL solve request/response (incl. base64 geometry). */
export const COMPUTE_DEBUG_VERBOSE = COMPUTE_DEBUG_MODE === 'verbose';

const cache = createClientCache({
	maxSolveDurationMs: MAX_SOLVE_DURATION_MS,
	maxConcurrentSolves: COMPUTE_MAX_CONCURRENT,
	maxConcurrentIsDefault: COMPUTE_MAX_CONCURRENT_IS_DEFAULT,
	maxQueueDepth: COMPUTE_MAX_QUEUE_DEPTH,
	queueWaitMs: COMPUTE_QUEUE_WAIT_MS,
	cachesolve: COMPUTE_SERVER_CACHESOLVE,
	cacheerroredsolves: COMPUTE_CACHE_ERRORED_SOLVES,
	reuseServerDefinitionCache: COMPUTE_REUSE_DEFINITION_CACHE,
	responseCacheMaxBytes: COMPUTE_SOLVE_CACHE_BYTES,
	debug: COMPUTE_DEBUG,
	debugVerbose: COMPUTE_DEBUG_VERBOSE,
	onDebugLog: (message) => getLogger().debug(message, { component: 'Compute/client-cache' })
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

/**
 * Solve-cache counters summed across every warm client, for the admin panel's
 * hit rate. Each warm client owns its own cache, so these are totals across
 * however many are alive right now (`warmClients`).
 */
export function solveCacheStats() {
	return cache.solveCacheStats();
}

export type { CachedClient };
