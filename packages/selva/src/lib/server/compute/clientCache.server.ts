import { GrasshopperClient, enableDebugLogging, type SolveScheduler } from '@selvajs/compute';
import { env } from '$env/dynamic/private';
import type { ComputeServerConfig } from '@selvajs/platform';
import {
	COMPUTE_CACHE_ERRORED_SOLVES,
	COMPUTE_REUSE_DEFINITION_CACHE,
	COMPUTE_SERVER_CACHESOLVE,
	MAX_SOLVE_DURATION_MS
} from '$lib/server/computeLimits';

// ============================================================================
// Shared compute client cache
// ============================================================================
//
// One warm `GrasshopperClient` (+ its `SolveScheduler`) per distinct compute
// server, keyed by `serverUrl + apiKey`. Definitions can pin different servers
// (`resolveServerForOrg` honors a per-definition pin → org default → global
// default), so this is deliberately a per-server LRU, NOT a single shared
// client — two definitions on two servers keep two warm clients; a churn of
// one-off servers is bounded by `MAX_CACHED_CLIENTS`.
//
// Both hot paths share this cache:
//   - the solve endpoint (`/api/compute`) uses the entry's `scheduler`;
//   - the definition-viewer render path (`loadForRender`) uses the entry's
//     `client` for `getIO`.
// Sharing means a definition that was just solved renders from the same warm
// client (and vice-versa) instead of re-handshaking Rhino.Compute per page load.
//
// Staleness: an operator rotating a server's apiKey/URL via /admin/compute
// produces a NEW cache key, so the next request transparently builds a fresh
// client and the old entry ages out via LRU. (Same semantics the solve cache
// had before this module was extracted.)

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
if (COMPUTE_DEBUG_VERBOSE) enableDebugLogging();

export interface CachedClient {
	client: GrasshopperClient;
	scheduler: SolveScheduler;
	/**
	 * Last decode/solve/encode reported by the compute server (Server-Timing).
	 * Written by onServerTiming, read right after scheduler.solve resolves to split
	 * the solve wall time into on-compute-server work vs. the compute↔web-server
	 * link (network transfer + queue). Queue-mode schedulers serialize solves, so
	 * this correlates with the request that just resolved; a Selva-cache hit leaves
	 * it null (no compute call). Debug aid — a concurrent burst may misattribute
	 * one request's timing to another.
	 */
	rhinoTiming: { last: { decode: number; solve: number; encode: number } | null };
	/**
	 * Last solve's cache verdicts from the scheduler's onSettle: whether Selva's
	 * in-process response cache served it (no compute call at all) and whether the
	 * definition had to be re-uploaded. Same read-after-solve pattern and
	 * concurrency caveat as rhinoTiming; surfaced on Server-Timing so the browser
	 * shows cache behaviour without server log access.
	 */
	solveMeta: { last: { fromCache: boolean; definitionReuploaded?: boolean } | null };
}

const MAX_CACHED_CLIENTS = 16;
const clientCache = new Map<string, CachedClient>();

function clientCacheKey(serverConfig: ComputeServerConfig): string {
	return `${serverConfig.serverUrl} ${serverConfig.apiKey ?? ''}`;
}

/**
 * Get (or create) the warm client + scheduler for a resolved compute server.
 * Callers pass the fully-resolved `ComputeServerConfig` (from
 * `resolveServerForOrg`) — the cache keys on its `serverUrl + apiKey`, so the
 * same server always hits the same entry regardless of which definition or path
 * asked for it.
 */
export async function getClient(serverConfig: ComputeServerConfig): Promise<CachedClient> {
	const key = clientCacheKey(serverConfig);
	const existing = clientCache.get(key);
	if (existing) {
		// Refresh LRU position.
		clientCache.delete(key);
		clientCache.set(key, existing);
		return existing;
	}

	// Holders for per-request results from the client/scheduler callbacks below;
	// the route reads them right after each solve resolves to build Server-Timing.
	const rhinoTiming: CachedClient['rhinoTiming'] = { last: null };
	const solveMeta: CachedClient['solveMeta'] = { last: null };

	const client = await GrasshopperClient.create({
		serverUrl: serverConfig.serverUrl,
		apiKey: serverConfig.apiKey,
		// Lib-level debug is the verbose one (full payload logs); keep it on the
		// verbose flag so the concise cache logs can run without the noise.
		debug: COMPUTE_DEBUG_VERBOSE,
		// Ask Rhino.Compute to cache solve results and return them on identical
		// repeats (same definition + inputs), skipping the solve. Forwarded to both
		// the pointer and full-upload solve paths via applyOptionalComputeSettings.
		cachesolve: COMPUTE_SERVER_CACHESOLVE,
		// Opt-in: also cache solves that reported GH errors (errors-by-design
		// definitions still produce correct geometry). See COMPUTE_CACHE_ERRORED_SOLVES.
		cacheerroredsolves: COMPUTE_CACHE_ERRORED_SOLVES,
		// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): the server's per-request timing breakdown,
		// which exposes the two SERVER-side caches at once:
		//   • Definition cache (pointer reuse): `decode` = deserialize + LOAD
		//     DEFINITION. A repeat solve loads the definition from the server's cache,
		//     so `decode` drops to ~0; a full (re)upload shows a larger `decode`.
		//   • Solve cache (cachesolve): when the server returns a CACHED RESULT it
		//     skips the solve, so `solve` drops to ~0 while decode/encode still run.
		// We flag each below so the contrast is obvious in the logs.
		onServerTiming: (t) => {
			const decode = t.decode ?? 0;
			const solve = t.solve ?? 0;
			const encode = t.encode ?? 0;
			// Always recorded (cheap): the route reads this after scheduler.solve to
			// split solve wall time into on-compute-server work vs. the network link
			// to the compute server. Only the console.log below is debug-gated.
			rhinoTiming.last = { decode, solve, encode };
			if (!COMPUTE_DEBUG) return;
			// Heuristic thresholds: a genuine parse/solve is many ms; a cache hit
			// is sub-millisecond. Only meaningful as a relative signal vs. the
			// first (cold) solve of the same definition.
			const defCache =
				decode <= 1 ? 'HIT (definition reused, no re-upload/parse)' : 'miss (full parse)';
			const solveCache =
				COMPUTE_SERVER_CACHESOLVE && solve <= 1
					? 'HIT (cached result, solve skipped)'
					: COMPUTE_SERVER_CACHESOLVE
						? 'miss (solved fresh)'
						: 'off';
			console.log(
				`[Compute/rhino-cache] decode=${decode}ms solve=${solve}ms encode=${encode}ms ` +
					`| definition-cache: ${defCache} | solve-cache (cachesolve): ${solveCache}`
			);
		}
	});
	const scheduler = client.createScheduler({
		mode: 'queue',
		timeoutMs: MAX_SOLVE_DURATION_MS,
		cache: { maxEntries: 20, ttlMs: 5 * 60_000 },
		// Solve large definitions by server cache-key (pointer) instead of re-uploading
		// the full binary every solve. On a stale-pointer miss the client (@selvajs/compute
		// >= 2.4.0) transparently re-uploads; the miss is detected via the server's
		// `code: "definition_not_cached"` (VektorNode fork). Env-gated so a deployment on
		// an unknown compute server can disable it — see COMPUTE_REUSE_DEFINITION_CACHE.
		reuseServerDefinitionCache: COMPUTE_REUSE_DEFINITION_CACHE,
		// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): observe the Selva in-process response
		// cache. `fromCache === true` means this solve was served from Selva's own
		// cache — Rhino.Compute was never called (you'll see NO [Compute/timing]
		// line for it). `false` means it went to the compute server.
		onSettle: (_ctx, result) => {
			if (result.status !== 'success') return;
			// Always recorded (cheap): the route surfaces these verdicts on the
			// Server-Timing header. Only the console.log below is debug-gated.
			solveMeta.last = {
				fromCache: result.fromCache === true,
				definitionReuploaded: result.definitionReuploaded
			};
			if (!COMPUTE_DEBUG) return;
			console.log(
				`[Compute/selva-cache] ${result.fromCache ? 'HIT  — served from Selva (no compute call)' : 'miss — went to Rhino.Compute'} (${Math.round(result.durationMs)}ms)`
			);
			// Definition-cache verdict for a real compute call (not a Selva-cache
			// HIT). `definitionReuploaded` (@selvajs/compute >= 2.6.0) tells us whether
			// the server reused its cached definition via the pointer (no upload) or
			// the client had to re-upload the full .gh because the pointer was
			// cold/stale. Independent of Server-Timing — works on any compute server.
			if (!result.fromCache) {
				console.log(
					result.definitionReuploaded === true
						? '[Compute/def-cache] miss — definition RE-UPLOADED (pointer was cold/stale)'
						: result.definitionReuploaded === false
							? '[Compute/def-cache] HIT  — definition reused from server cache (no upload)'
							: '[Compute/def-cache] n/a — reuse disabled or non-reusable definition'
				);
			}
			// Surface real GH errors when present. An errored solve returns HTTP 500
			// (the lib still returns partial geometry, so the UI works) and is NEVER
			// cached server-side (cachesolve only stores error-free solves), so such a
			// definition can't get a solve-cache hit until its errors are fixed.
			if (!result.fromCache) {
				const errs = (result.response as { errors?: unknown[] })?.errors;
				const errCount = Array.isArray(errs) ? errs.length : 0;
				if (errCount > 0) {
					console.log(
						`[Compute/rhino-cache] ${errCount} GH error(s); not cacheable until fixed. First: ${JSON.stringify((errs as unknown[])[0])}`
					);
				}
			}
		}
	});
	const entry: CachedClient = { client, scheduler, rhinoTiming, solveMeta };

	// Evict the least-recently-used entry before inserting when at capacity.
	if (clientCache.size >= MAX_CACHED_CLIENTS) {
		const oldestKey = clientCache.keys().next().value;
		if (oldestKey !== undefined) {
			clientCache.get(oldestKey)?.scheduler.dispose();
			clientCache.delete(oldestKey);
		}
	}

	clientCache.set(key, entry);
	return entry;
}
