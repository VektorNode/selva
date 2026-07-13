/**
 * App-wide binding for the durable L2 solve cache (H1).
 *
 * The backend (`memory` today, `off` by default) lives in `@selvajs/server`; this
 * module owns the single instance selected by `SOLVE_CACHE_PROVIDER`, plus:
 *
 *   - `resolveSolveCacheQuota(record)` — the definition's effective quota from its
 *     `solveCacheLimit` (absent → global default, 0 → off, N → cap);
 *   - `buildSolveCacheHook(...)` — the closure `runSolvePipeline` consumes, bound
 *     to one solve's org/definition/version + quota. Returns `null` when caching
 *     is off for this solve (quota 0, no org, or backend off) so the route simply
 *     omits the hook — the pipeline then never touches L2 (channel gating by hook
 *     presence);
 *   - `solveCacheSingleFlight` — in-process dogpile protection (R4) the route wraps
 *     the whole pipeline call in, so N identical concurrent live solves share one
 *     execution.
 *
 * Only live-channel, org-scoped local solves are cached (channel decision 4): the
 * route passes the hook only for those. Drafts and remote-URL solves never reach
 * here.
 */

import {
	createMemorySolveResultCache,
	createSolveCacheSingleFlight,
	type SolveCacheConfigSubset,
	type SolvePipelineCacheHook,
	type MemorySolveResultCache
} from '@selvajs/server/compute';
import {
	NoopSolveResultCache,
	type ISolveResultCache,
	type RequestContext
} from '@selvajs/platform';
import {
	SOLVE_CACHE_PROVIDER,
	SOLVE_CACHE_DEFAULT_MAX_ENTRIES,
	SOLVE_CACHE_MAX_TOTAL_BYTES
} from '$lib/server/computeLimits';
import { COMPUTE_DEBUG } from './clientCache.server';

// Single instance. `memory` mounts the in-process backend; anything else is a
// no-op (`off`). Only the memory backend exposes `stats()`, so keep a typed
// handle to it for the admin/debug surface.
const memoryCache: MemorySolveResultCache | null =
	SOLVE_CACHE_PROVIDER === 'memory'
		? createMemorySolveResultCache(SOLVE_CACHE_MAX_TOTAL_BYTES)
		: null;

const cache: ISolveResultCache = memoryCache ?? new NoopSolveResultCache();

/** In-process single-flight (R4), shared across the instance. */
export const solveCacheSingleFlight = createSolveCacheSingleFlight({
	onJoin: (key) => {
		if (COMPUTE_DEBUG) {
			// Key = org:version:inputs-json — truncate the inputs tail for the log.
			console.log(`[Compute/single-flight] coalesced onto in-flight solve ${key.slice(0, 96)}…`);
		}
	}
});

/** True when a real L2 backend is mounted (not the Noop). */
export const solveCacheEnabled = memoryCache !== null;

/**
 * Resolve a definition's effective L2 quota. `solveCacheLimit` absent → inherit
 * the global default; `0` → caching off; `N` → cap. Returns the entry cap, or `0`
 * when caching is off for this definition.
 */
export function resolveSolveCacheQuota(solveCacheLimit: number | undefined): number {
	if (solveCacheLimit === undefined) return SOLVE_CACHE_DEFAULT_MAX_ENTRIES;
	return Math.max(0, Math.floor(solveCacheLimit));
}

/**
 * Build the pipeline's L2 hook for one live solve, or `null` when this solve must
 * not be cached (backend off, no org, or a resolved quota of 0). The route passes
 * the returned value straight into `runSolvePipeline({ solveCache })`; a `null`
 * means the pipeline skips L2 entirely.
 */
export function buildSolveCacheHook(params: {
	ctx: RequestContext;
	orgId: string | null;
	definitionId: string;
	versionId: string;
	quota: number;
	configSubset: SolveCacheConfigSubset;
}): SolvePipelineCacheHook | null {
	if (!solveCacheEnabled || params.quota <= 0 || !params.orgId) return null;
	const { ctx, orgId, definitionId, versionId, quota, configSubset } = params;
	return {
		configSubset,
		lookup: (inputKey) =>
			cache.get(ctx, { orgId, definitionId, versionId, inputKey }).catch((err) => {
				// The pipeline treats any rejection as a miss; log it here so a faulting
				// backend doesn't silently disable caching (every solve re-solving).
				console.warn(`[Compute/l2-cache] lookup failed for definition ${definitionId}:`, err);
				return null;
			}),
		store: (inputKey, entry) => {
			// Fire-and-forget: the solve already succeeded and was returned, so a
			// cache write must never turn into a request error. Best-effort by contract
			// — but log the failure, or a permanently-broken backend is invisible.
			void cache
				.set(ctx, { orgId, definitionId, versionId, inputKey }, entry, {
					maxEntriesForDefinition: quota
				})
				.catch((err) => {
					console.warn(`[Compute/l2-cache] store failed for definition ${definitionId}:`, err);
				});
		}
	};
}

/** L2 counters for admin/debug surfaces; null when the backend is off. */
export function solveCacheStats() {
	return memoryCache?.stats() ?? null;
}
