import {
	GrasshopperClient,
	type GrasshopperComputeConfig,
	type SolveScheduler
} from '@selvajs/compute/grasshopper';
import { enableDebugLogging } from '@selvajs/compute/core';

// ============================================================================
// Shared compute client cache
// ============================================================================
//
// One warm `GrasshopperClient` (+ its `SolveScheduler`) per distinct compute
// server, keyed by the server's `id`, never its URL — a rotated URL/apiKey
// keeps the same key with stale connection details, so the config-write path
// MUST call `evict(id)` when a server's config changes.
//
// Per-server LRU, not a single shared client: definitions can pin different
// servers, so two definitions on two servers keep two warm clients, with
// churn from one-off servers bounded by `maxWarmComputeServers`.
//
// Both hot paths share this cache — the solve endpoint uses the entry's
// `scheduler`; the definition-viewer render path uses the entry's `client`
// for `getIO` — so a definition that was just solved renders from the same
// warm client instead of re-handshaking Rhino.Compute per page load.

/**
 * Opaque identity of a compute server — construct only via `serverIdentity()`.
 * Kept opaque so "a server is now a pool of URLs behind one id" stays additive.
 */
export type ServerIdentity = string & { readonly __brand: 'ServerIdentity' };

/** Minimal resolved-server shape the cache needs (a subset of the app's `ComputeServerConfig`). */
export interface ResolvedServer {
	id: string;
	serverUrl: string;
	/** Sent as the `RhinoComputeKey` header. */
	apiKey?: string;
}

export function serverIdentity(server: Pick<ResolvedServer, 'id'>): ServerIdentity {
	return server.id as ServerIdentity;
}

export interface CachedClient {
	client: GrasshopperClient;
	scheduler: SolveScheduler;
	/**
	 * Last Server-Timing decode/solve/encode, written by `onServerTiming`. The
	 * scheduler runs up to `maxConcurrent` solves at once, so `last` alone can't
	 * be trusted per-request: callers snapshot `seq` before their solve and only
	 * attribute `last` to themselves if exactly one write happened since (see
	 * the guard in `runSolvePipeline`), dropping it otherwise rather than risk
	 * misattributing another request's timing.
	 */
	rhinoTiming: { last: { decode: number; solve: number; encode: number } | null; seq: number };
	/**
	 * Same snapshot-and-attribute pattern as `rhinoTiming`, for the scheduler's
	 * `onSettle` cache verdict. `seq` increments on every settle (success or
	 * error); `last` is written only on success.
	 */
	solveMeta: {
		last: { fromCache: boolean; definitionReuploaded?: boolean } | null;
		seq: number;
	};
}

/**
 * Debug verbosity: `false` is silent, `true` gives concise cache/timing logs
 * (`onDebugLog`), `'verbose'` also enables full lib-level request/response
 * dumps (incl. geometry) — a superset of `true`, not an independent setting.
 */
export type ClientCacheDebug = boolean | 'verbose';

/** Config injected by the consuming app, so this module stays env-agnostic and testable. */
export interface ClientCacheConfig {
	/** Per-solve timeout forwarded to the scheduler (`ComputeLimits.solveDeadlineMs`). */
	solveDeadlineMs: number;
	cachesolve: boolean;
	/** Only meaningful with `cachesolve`. */
	cacheerroredsolves: boolean;
	/** Reference large definitions by server cache key instead of re-uploading. */
	reuseServerDefinitionCache: boolean;
	/**
	 * Max solves that may wait in the FIFO queue, excluding in-flight solves
	 * (capped at `maxConcurrent`, itself driven by the server's probed child
	 * count). `0` = unbounded (`ComputeLimits.computeMaxQueueDepth`); a full
	 * queue rejects new solves with `QUEUE_FULL`.
	 */
	maxQueueDepth: number;
	/**
	 * Max ms a solve may sit queued before executing; `0` = no deadline
	 * (`ComputeLimits.computeQueueWaitMs`). Too long a wait rejects with
	 * `QUEUE_TIMEOUT`.
	 */
	queueWaitMs: number;
	/**
	 * Byte budget for this client's in-process solve cache. Applies per warm
	 * client — worst-case heap is this × `maxWarmComputeServers`. `0` disables
	 * the cache (`ComputeLimits.computeSolveCacheBytes`, env `COMPUTE_SOLVE_CACHE_MB`).
	 */
	responseCacheMaxBytes: number;
	debug: ClientCacheDebug;
	/** Max distinct warm compute servers before the LRU evicts the oldest. Default 16. */
	maxWarmComputeServers?: number;
	/** Sink for the debug lines. `onDebugLog` only fires when `debug` is not `false`. */
	onDebugLog?: (message: string) => void;
}

export interface ClientCache {
	/**
	 * Get (or create) the warm client + scheduler for a resolved compute server,
	 * keyed by its `id`. `definitionGuid`, when present, is stamped as the
	 * `X-Selva-Definition` header on this client's outbound solve/IO requests —
	 * inert routing/telemetry metadata until a pool router exists.
	 */
	getClient(server: ResolvedServer, opts?: { definitionGuid?: string }): Promise<CachedClient>;
	/** Dispose and drop the warm client for `id`, so the next request rebuilds against fresh connection details. */
	evict(id: string | ServerIdentity): void;
	/** Solve-cache counters summed across every warm client. Counters die with the client that owns them, so totals can fall over time. */
	solveCacheStats(): SolveCacheStats;
	/**
	 * Drop every retained solve result, keeping the warm clients (and their
	 * connections and server-side definition pointers) intact. Nothing expires
	 * these on its own — the byte budget is the only other pressure — so this is
	 * the operator's release valve when a definition's inputs no longer describe
	 * its output, e.g. it reads an external source that has since changed.
	 */
	clearSolveCaches(): void;
	/** Dispose every warm client. Test seam / shutdown hook. */
	disposeAll(): void;
}

export interface SolveCacheStats {
	warmClients: number;
	entries: number;
	bytes: number;
	hits: number;
	misses: number;
	/** Entries dropped under size/byte pressure (not replacement or manual clears). */
	evictions: number;
}

const DEFAULT_MAX_WARM_COMPUTE_SERVERS = 16;

/**
 * Fallback concurrency while the first probe is still in flight, and the value
 * kept whenever a probe fails or reports 0 — never send more than a single
 * solve to a server whose real capacity is unknown.
 */
const FALLBACK_CONCURRENCY = 1;

/**
 * How stale the compute server's child count may get before a solve triggers a
 * re-read. Short enough that a resized pool is picked up within a few solves,
 * long enough that a busy server is probed rarely — the probe rides on solve
 * completion, so an idle server is never polled at all.
 */
const CONCURRENCY_PROBE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long a failed build is remembered before the next `getClient` retries the
 * handshake. Without this, every solve against a down server pays the full probe
 * ladder again, so a user clicking Solve twice waits twice.
 *
 * Short on purpose: this is a convenience for the rapid-retry case, not a
 * circuit breaker. An operator who starts the compute VM should not have to wait
 * out a long penalty window before the app notices.
 */
const FAILED_BUILD_TTL_MS = 5000;

/**
 * A build failure worth replaying to the next caller, with the time it happened
 * so {@link FAILED_BUILD_TTL_MS} can expire it.
 */
interface FailedBuild {
	error: unknown;
	at: number;
}

export function createClientCache(config: ClientCacheConfig): ClientCache {
	const maxWarmComputeServers = config.maxWarmComputeServers ?? DEFAULT_MAX_WARM_COMPUTE_SERVERS;
	const cache = new Map<string, CachedClient>();
	// Builds in flight, keyed like `cache`. Concurrent `getClient` calls for the
	// same id must share ONE build: without this, both miss, both handshake, and
	// the loser's entry is overwritten in the map without ever being disposed.
	const pending = new Map<string, Promise<CachedClient>>();
	// Recent build failures, keyed like `cache`. Cleared by `evict` so a config
	// fix takes effect immediately rather than waiting out the TTL.
	const failed = new Map<string, FailedBuild>();

	if (config.debug === 'verbose') enableDebugLogging();

	const debugLog = (message: string) => {
		if (config.debug) config.onDebugLog?.(message);
	};

	async function build(server: ResolvedServer, definitionGuid?: string): Promise<CachedClient> {
		const rhinoTiming: CachedClient['rhinoTiming'] = { last: null, seq: 0 };
		const solveMeta: CachedClient['solveMeta'] = { last: null, seq: 0 };
		const debugVerbose = config.debug === 'verbose';

		const clientConfig: GrasshopperComputeConfig = {
			serverUrl: server.serverUrl,
			apiKey: server.apiKey,
			// Lib-level debug is the verbose one (full payload logs); keep it on the
			// verbose flag so the concise cache logs can run without the noise.
			debug: debugVerbose,
			cachesolve: config.cachesolve,
			cacheerroredsolves: config.cacheerroredsolves,
			onServerTiming: (t) => {
				const decode = t.decode ?? 0;
				const solve = t.solve ?? 0;
				const encode = t.encode ?? 0;
				rhinoTiming.seq += 1;
				rhinoTiming.last = { decode, solve, encode };
				if (!config.debug) return;
				// Heuristic thresholds: a genuine parse/solve is many ms; a cache hit
				// is sub-millisecond. Only meaningful relative to the first (cold) solve.
				const defCache =
					decode <= 1 ? 'HIT (definition reused, no re-upload/parse)' : 'miss (full parse)';
				const solveCache =
					config.cachesolve && solve <= 1
						? 'HIT (cached result, solve skipped)'
						: config.cachesolve
							? 'miss (solved fresh)'
							: 'off';
				debugLog(
					`[Compute/rhino-cache] decode=${decode}ms solve=${solve}ms encode=${encode}ms ` +
						`| definition-cache: ${defCache} | solve-cache (cachesolve): ${solveCache}`
				);
			}
		};

		// Baked at client-create time because the scheduler has no per-request
		// header hook.
		if (definitionGuid) {
			clientConfig.headers = { 'X-Selva-Definition': definitionGuid };
		}

		const client = await GrasshopperClient.create(clientConfig);

		// rhino.compute hands out children in strict rotation and never reports "busy",
		// so nothing downstream enforces a concurrency cap — send more than it has
		// children and requests silently double up on one. Rhino.Compute is the only
		// source of truth for its own child count, so this always probes rather than
		// trusting an operator-supplied guess.
		//
		// The count is not static: children exit on their own under `-idlespan`, and
		// `/launch-child` + `/recycle-children` resize the pool at runtime. So the probe
		// re-runs after solves (see `refreshConcurrency`) rather than only at connect.
		let maxConcurrent = FALLBACK_CONCURRENCY;
		let lastProbeAt = 0;
		let probing = false;

		/**
		 * Best-effort re-read of the server's child count. Never awaited by a caller:
		 * a probe must not add a round-trip to the solve path, so a changed count takes
		 * effect on the NEXT solve rather than the one that triggered the probe.
		 *
		 * `initialize: false` keeps this from spawning children on an idle server —
		 * which also means a cold server honestly reports 0. Both a failed probe and a
		 * 0 result fall back to `FALLBACK_CONCURRENCY` (1): an unknown-capacity server
		 * is safer under-used than oversent.
		 */
		async function refreshConcurrency(scheduler?: { setMaxConcurrent(n: number): void }) {
			if (probing) return;
			probing = true;
			try {
				const children = await Promise.resolve(
					client.serverStats?.getActiveChildren({ initialize: false })
				).catch(() => null);
				lastProbeAt = Date.now();
				const next = !children || children <= 0 ? FALLBACK_CONCURRENCY : children;
				if (next === maxConcurrent) return;
				debugLog(
					`[Compute/client-cache] concurrency ${maxConcurrent} → ${next} (server child count)`
				);
				maxConcurrent = next;
				scheduler?.setMaxConcurrent(next);
			} finally {
				probing = false;
			}
		}

		// One blocking probe at connect so the first solves already use the right cap.
		await refreshConcurrency();

		const scheduler = client.createScheduler({
			mode: 'queue',
			// Queue mode defaults maxConcurrent to 1, serializing every solve on
			// this server through a single slot while the compute VM's other
			// compute.geometry children idle — always pass it explicitly.
			maxConcurrent,
			// The scheduler treats undefined as unbounded/no-deadline, so map our
			// `0`-means-off convention to undefined rather than passing 0 (which
			// would reject EVERY queued solve).
			maxQueueDepth: config.maxQueueDepth || undefined,
			queueWaitMs: config.queueWaitMs || undefined,
			timeoutMs: config.solveDeadlineMs,
			// The byte budget is the only eviction pressure. A solve is a pure
			// function of (definition, inputs), both immutable, so a retained
			// result can never go stale — expiring one only forces a paid re-solve
			// of the identical answer.
			cache: config.responseCacheMaxBytes > 0 ? { maxBytes: config.responseCacheMaxBytes } : false,
			reuseServerDefinitionCache: config.reuseServerDefinitionCache,
			onSettle: (_ctx, result) => {
				solveMeta.seq += 1;
				if (result.status !== 'success') return;
				// Piggyback the pool re-read on real traffic: only servers actually
				// being used get probed, at most once per window, and never on the
				// request path. A cache hit means we never reached the server, so it
				// says nothing about the pool — don't spend a probe on it.
				if (
					result.fromCache !== true &&
					Date.now() - lastProbeAt >= CONCURRENCY_PROBE_INTERVAL_MS
				) {
					// Safe despite being referenced from inside its own initializer:
					// onSettle only ever fires during a solve, long after binding.
					void refreshConcurrency(scheduler);
				}
				solveMeta.last = {
					fromCache: result.fromCache === true,
					definitionReuploaded: result.definitionReuploaded
				};
				if (!config.debug) return;
				debugLog(
					`[Compute/selva-cache] ${result.fromCache ? 'HIT  — served from cache (no compute call)' : 'miss — went to Rhino.Compute'} (${Math.round(result.durationMs)}ms)`
				);
				if (!result.fromCache) {
					debugLog(
						result.definitionReuploaded === true
							? '[Compute/def-cache] miss — definition RE-UPLOADED (pointer was cold/stale)'
							: result.definitionReuploaded === false
								? '[Compute/def-cache] HIT  — definition reused from server cache (no upload)'
								: '[Compute/def-cache] n/a — reuse disabled or non-reusable definition'
					);
				}
				if (!result.fromCache) {
					const errs = (result.response as { errors?: unknown[] })?.errors;
					const errCount = Array.isArray(errs) ? errs.length : 0;
					if (errCount > 0) {
						const cacheNote = config.cacheerroredsolves
							? 'cached (cacheerroredsolves on)'
							: 'not cached (cacheerroredsolves off) — re-run until fixed';
						debugLog(
							`[Compute/rhino-cache] ${errCount} GH error(s); ${cacheNote}. First: ${JSON.stringify((errs as unknown[])[0])}`
						);
					}
				}
			}
		});
		return { client, scheduler, rhinoTiming, solveMeta };
	}

	return {
		async getClient(server, opts): Promise<CachedClient> {
			const key = server.id;
			const existing = cache.get(key);
			if (existing) {
				// Refresh LRU position.
				cache.delete(key);
				cache.set(key, existing);
				return existing;
			}

			const inFlight = pending.get(key);
			if (inFlight) return inFlight;

			// Replay a recent failure instead of re-running the probe ladder. The
			// original error is rethrown verbatim so the caller still sees the real
			// cause (refused / unauthorized / timeout), not a generic cache miss.
			const recentFailure = failed.get(key);
			if (recentFailure) {
				if (Date.now() - recentFailure.at < FAILED_BUILD_TTL_MS) {
					debugLog(
						`[Compute/client-cache] server ${key} failed to build <${FAILED_BUILD_TTL_MS}ms ago — replaying error`
					);
					throw recentFailure.error;
				}
				failed.delete(key);
			}

			// A build is a Rhino.Compute handshake — expensive, and repeated builds for
			// the same id mean churn (LRU thrash or config-rotation evictions).
			debugLog(`[Compute/client-cache] miss — building warm client for server ${key}`);
			const buildPromise = (async () => {
				let entry: CachedClient;
				try {
					entry = await build(server, opts?.definitionGuid);
				} catch (err) {
					failed.set(key, { error: err, at: Date.now() });
					throw err;
				}

				if (cache.size >= maxWarmComputeServers) {
					const oldestKey = cache.keys().next().value;
					if (oldestKey !== undefined) {
						debugLog(
							`[Compute/client-cache] LRU evicted warm client for server ${oldestKey} (cap ${maxWarmComputeServers})`
						);
						cache.get(oldestKey)?.scheduler.dispose();
						cache.delete(oldestKey);
					}
				}

				cache.set(key, entry);
				return entry;
			})().finally(() => pending.delete(key));
			pending.set(key, buildPromise);
			return buildPromise;
		},

		evict(id): void {
			const key = id as string;
			// Drop any remembered failure too: `evict` means the connection details
			// changed, so the reason the last build failed no longer applies.
			failed.delete(key);
			const entry = cache.get(key);
			if (entry) {
				debugLog(`[Compute/client-cache] evicted warm client for server ${key} (config change)`);
				entry.scheduler.dispose();
				cache.delete(key);
			}
		},

		solveCacheStats(): SolveCacheStats {
			const total: SolveCacheStats = {
				warmClients: cache.size,
				entries: 0,
				bytes: 0,
				hits: 0,
				misses: 0,
				evictions: 0
			};
			for (const entry of cache.values()) {
				const s = entry.scheduler.cacheStats();
				total.entries += s.entries;
				total.bytes += s.bytes;
				total.hits += s.hits;
				total.misses += s.misses;
				total.evictions += s.evictions;
			}
			return total;
		},

		clearSolveCaches(): void {
			debugLog(`[Compute/client-cache] cleared solve caches on ${cache.size} warm client(s)`);
			for (const entry of cache.values()) entry.scheduler.clearCache();
		},

		disposeAll(): void {
			debugLog(`[Compute/client-cache] disposing all ${cache.size} warm client(s)`);
			for (const entry of cache.values()) entry.scheduler.dispose();
			cache.clear();
			failed.clear();
		}
	};
}
