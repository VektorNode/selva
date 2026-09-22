/**
 * App-wide `SolveEngine` instance (`@selvajs/solve/server`) — backs the warm
 * client cache, the definition-byte cache, and solve coalescing for the whole app.
 */

import { SolveEngine, type CachedClient } from '@selvajs/solve/server';
import { env } from '$env/dynamic/private';
import { getLogger, lazyLogger } from '$lib/server/providers.server';
import { computeLimits } from '$lib/server/computeLimits';
import type { ComputeServerConfig } from '@selvajs/platform';

/**
 * `SELVA_FLAG_COMPUTE_DEBUG` is a three-way knob, not a boolean: `off` (default),
 * `on` (concise cache/timing logs), or `verbose` (adds full lib-level request/
 * response dumps, incl. base64 geometry). `verbose` implies `on`.
 *
 * `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE` still honoured (as `verbose`) so an
 * operator's existing `.env` degrades to a warning instead of silently losing
 * the verbose logging they asked for.
 */
const COMPUTE_DEBUG_MODE = (() => {
	const raw = (env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase();
	if (raw === 'verbose') return 'verbose';
	const on = ['true', '1', 'yes', 'on'].includes(raw);

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

export const COMPUTE_DEBUG = COMPUTE_DEBUG_MODE !== 'off';
export const COMPUTE_DEBUG_VERBOSE = COMPUTE_DEBUG_MODE === 'verbose';

export const engine = new SolveEngine({
	limits: computeLimits,
	logger: lazyLogger,
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
export function getClient(
	serverConfig: ComputeServerConfig,
	opts?: { definitionGuid?: string }
): Promise<CachedClient> {
	return engine.getClient(
		{ id: serverConfig.id, serverUrl: serverConfig.serverUrl, apiKey: serverConfig.apiKey },
		opts
	);
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
