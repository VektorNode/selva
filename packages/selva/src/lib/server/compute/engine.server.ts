/**
 * App-wide `SolveEngine` instance — replaces the previous hand-assembled trio
 * (`clientCache.server.ts` + `definitionByteCache.server.ts` + `solveCache.server.ts`)
 * with the facade from `@selvajs/solve/server`. One instance backs the warm
 * client cache, the definition-byte cache, and solve coalescing for the whole app.
 */

import { SolveEngine, type CachedClient } from '@selvajs/solve/server';
import { env } from '$env/dynamic/private';
import { getLogger, lazyLogger } from '$lib/server/providers.server';
import { computeLimits } from '$lib/server/computeLimits';
import type { ComputeServerConfig } from '@selvajs/platform';

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

export const engine = new SolveEngine({
	limits: computeLimits,
	logger: lazyLogger,
	debug: COMPUTE_DEBUG ? (COMPUTE_DEBUG_VERBOSE ? 'verbose' : true) : false,
	onDebugLog: (message) => getLogger().debug(message, { component: 'Compute/client-cache' }),
	onSolveCoalesced: (key) => {
		if (COMPUTE_DEBUG) {
			// Key = version:server:tree-json — truncate the tree tail for the log.
			getLogger().debug('Coalesced onto in-flight solve', {
				component: 'Compute/single-flight',
				key: `${key.slice(0, 96)}…`
			});
		}
	}
});

/**
 * Get (or create) the warm client + scheduler for a resolved compute server.
 * Also used by the render/IO path (`loadForRender.server.ts`), which is not a
 * solve but shares the same warm client for `getIO`.
 */
export function getClient(
	serverConfig: ComputeServerConfig,
	opts?: { definitionGuid?: string }
): Promise<CachedClient> {
	return engine.getClient(
		{ id: serverConfig.id, serverUrl: serverConfig.serverUrl, apiKey: serverConfig.apiKey },
		opts
	);
}

/**
 * Drop the warm client for a server whose config just changed (URL/key rotation
 * or deletion via /admin/compute or /api/org/compute).
 */
export function evictComputeClient(id: string): void {
	engine.evictServer(id);
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
