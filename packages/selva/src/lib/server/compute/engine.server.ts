/**
 * App-wide `SolveEngine` instance (`@selvajs/solve/server`) — backs the warm
 * client cache, the definition-byte cache, and solve coalescing for the whole app.
 */

import { SolveEngine, type CachedClient } from '@selvajs/solve/server';
import { env } from '#lib/server/env.js';
import { getLogger } from '#lib/server/providers.server.js';
import { computeLimits } from '#lib/server/computeLimits.js';
import { computeDebugMode } from '#lib/server/config/settings.js';
import type { ComputeServerConfig } from '@selvajs/platform';

// `verbose` adds lib-level request logs and Compute's raw error bodies, and implies `on`.
const COMPUTE_DEBUG_MODE = computeDebugMode(env);

export const COMPUTE_DEBUG = COMPUTE_DEBUG_MODE !== 'off';
export const COMPUTE_DEBUG_VERBOSE = COMPUTE_DEBUG_MODE === 'verbose';

export const engine = new SolveEngine({
	limits: computeLimits,
	debug: COMPUTE_DEBUG ? (COMPUTE_DEBUG_VERBOSE ? 'verbose' : true) : false,
	onDebugLog: (message) => getLogger().debug(message, { component: 'Compute/client-cache' }),
	onSolveCoalesced: (key) => {
		if (COMPUTE_DEBUG) {
			// key = version:server:tree-json — truncate the tree tail for the log.
			getLogger().debug('Coalesced onto in-flight solve', {
				component: 'Compute/single-flight',
				key: `${key.slice(0, 96)}…`
			});
		}
	}
});

/** Get (or create) the warm client + scheduler for a resolved compute server. */
export function getClient(serverConfig: ComputeServerConfig): Promise<CachedClient> {
	return engine.getClient({
		id: serverConfig.id,
		serverUrl: serverConfig.serverUrl,
		apiKey: serverConfig.apiKey
	});
}

/** Drop the warm client for a server whose config just changed (URL/key rotation or deletion). */
export function evictComputeClient(id: string): void {
	engine.evictServer(id);
}

/**
 * Drop cached solve results held by this Selva process (every warm client's
 * scheduler). Separate from the compute server's own `cache/purge`: that one
 * clears Rhino's `cachesolve`, this one clears the layer in front of it.
 */
export function clearSolveResultCache(): void {
	engine.clearSolveCaches();
}

/** Drop the `.gh` bytes this Selva process is holding. Costs a storage re-read, nothing more. */
export function clearDefinitionCache(): void {
	engine.clearDefinitionCache();
}

/** Solve-cache counters for the admin panel's hit rate. */
export function solveCacheStats() {
	return engine.stats().client;
}

/** Definition-byte-cache counters (hits/misses/evictions/entries/bytes) for admin/debug surfaces. */
export function definitionByteCacheStats() {
	return engine.stats().definitionBytes;
}

/** Materialize a version's bytes through the shared byte cache (render/IO path). */
export function loadDefinitionBytes(
	versionId: string,
	load: () => Promise<Uint8Array>
): Promise<Uint8Array> {
	return engine.definitionRef(versionId, load).load();
}

export type { CachedClient };
