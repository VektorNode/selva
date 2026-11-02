import {
	GrasshopperClient,
	type GrasshopperComputeConfig,
	type SolveScheduler
} from '@selvajs/compute/grasshopper';
import { ComputeError, enableDebugLogging, ErrorCodes } from '@selvajs/compute/core';

import { createConcurrencyProbe } from './concurrency-probe';
import { fetchForDeadline } from './long-fetch';

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

/** Minimal resolved-server shape the cache needs (a subset of the app's `ComputeServerConfig`). */
export interface ResolvedServer {
	id: string;
	serverUrl: string;
	/** Sent as the `RhinoComputeKey` header. */
	apiKey?: string;
}

export interface CachedClient {
	client: GrasshopperClient;
	scheduler: SolveScheduler;
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
	/**
	 * Largest compute response body read; past it the download is cancelled (`too_large`).
	 * Default: no limit.
	 */
	maxResponseBytes?: number;
	debug: ClientCacheDebug;
	/** Max distinct warm compute servers before the LRU evicts the oldest. */
	maxWarmComputeServers?: number;
	/** Sink for the debug lines. `onDebugLog` only fires when `debug` is not `false`. */
	onDebugLog?: (message: string) => void;
}

export interface ClientCache {
	/**
	 * Get (or create) the warm client + scheduler for a resolved compute server, keyed by its `id`.
	 *
	 * @throws {ComputeError} `ABORTED` when `evict` or `disposeAll` overtakes the build.
	 */
	getClient(server: ResolvedServer, opts?: { definitionGuid?: string }): Promise<CachedClient>;
	/**
	 * Drops the warm client for `id`, so the next request rebuilds, and disposes it once idle. A
	 * build in flight for `id` is abandoned.
	 */
	evict(id: string): void;
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
	/** Dispose every warm client now, running solves included. Test seam / shutdown hook. */
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

interface PendingBuild {
	promise: Promise<CachedClient>;
	/** Set when the connection details this build started from stopped being true. */
	token: { stale: boolean };
}

interface SettledSolve {
	fromCache?: boolean;
	durationMs: number;
	definitionReuploaded?: boolean;
	response?: { errors?: unknown };
}

function describeSettledSolve(result: SettledSolve): string[] {
	const verdict = result.fromCache
		? 'HIT  — served from cache (no compute call)'
		: 'miss — went to Rhino.Compute';
	const lines = [`[Compute/selva-cache] ${verdict} (${Math.round(result.durationMs)}ms)`];
	if (result.fromCache) return lines;

	lines.push(
		result.definitionReuploaded === true
			? '[Compute/def-cache] miss — definition RE-UPLOADED (pointer was cold/stale)'
			: result.definitionReuploaded === false
				? '[Compute/def-cache] HIT  — definition reused from server cache (no upload)'
				: '[Compute/def-cache] n/a — reuse disabled or non-reusable definition'
	);
	const errors = result.response?.errors;
	if (Array.isArray(errors) && errors.length > 0) {
		// A count: solver text can quote user input, and logs are out of erasure's reach.
		lines.push(`[Compute/rhino-cache] ${errors.length} GH error(s); not cached by Rhino.Compute.`);
	}
	return lines;
}

export function createClientCache(config: ClientCacheConfig): ClientCache {
	const maxWarmComputeServers = config.maxWarmComputeServers ?? DEFAULT_MAX_WARM_COMPUTE_SERVERS;
	const cache = new Map<string, CachedClient>();
	// Builds in flight, keyed like `cache`. Concurrent `getClient` calls for the
	// same id must share ONE build: without this, both miss, both handshake, and
	// the loser's entry is overwritten in the map without ever being disposed.
	const pending = new Map<string, PendingBuild>();
	// Recent build failures, keyed like `cache`. Cleared by `evict` so a config
	// fix takes effect immediately rather than waiting out the TTL.
	const failed = new Map<string, FailedBuild>();
	// Out of `cache`, waiting for their running solves to finish.
	const draining = new Set<CachedClient>();

	if (config.debug === 'verbose') enableDebugLogging();

	const debugLog = (message: string) => {
		if (config.debug) config.onDebugLog?.(message);
	};

	function isIdle({ scheduler }: CachedClient) {
		return scheduler.inFlightCount === 0 && scheduler.queueDepth === 0;
	}

	/** Disposing a busy scheduler aborts its solves, so a config write would fail them all. */
	function retire(entry: CachedClient) {
		if (isIdle(entry)) entry.scheduler.dispose();
		else draining.add(entry);
	}

	function finishDraining(entry: CachedClient) {
		if (!draining.has(entry) || !isIdle(entry)) return;
		draining.delete(entry);
		entry.scheduler.dispose();
	}

	async function build(server: ResolvedServer, definitionGuid?: string): Promise<CachedClient> {
		const debugVerbose = config.debug === 'verbose';
		const longFetch = fetchForDeadline(config.solveDeadlineMs);

		const clientConfig: GrasshopperComputeConfig = {
			serverUrl: server.serverUrl,
			apiKey: server.apiKey,
			// Lib-level debug is the verbose one; keep it on the verbose flag so the
			// concise cache logs can run without the noise.
			debug: debugVerbose,
			cachesolve: config.cachesolve,
			maxResponseBytes: config.maxResponseBytes,
			...(longFetch && { fetch: longFetch })
		};

		if (config.debug) {
			clientConfig.onServerTiming = (t) => {
				if (t.cacheHit) {
					debugLog(
						'[Compute/rhino-cache] solve-cache (cachesolve): HIT (cached result, solve skipped)'
					);
					return;
				}
				const decode = t.decode ?? 0;
				const solve = t.solve ?? 0;
				const encode = t.encode ?? 0;
				// Heuristic threshold: a genuine parse is many ms; a reused definition is
				// sub-millisecond. Only meaningful relative to the first (cold) solve.
				const defCache =
					decode <= 1 ? 'HIT (definition reused, no re-upload/parse)' : 'miss (full parse)';
				const solveCache = config.cachesolve ? 'miss (solved fresh)' : 'off';
				const ran = t.recomputed ? ` | ran ${t.recomputed.ran}/${t.recomputed.total} objects` : '';
				debugLog(
					`[Compute/rhino-cache] decode=${decode}ms solve=${solve}ms encode=${encode}ms ` +
						`| definition-cache: ${defCache} | solve-cache (cachesolve): ${solveCache}${ran}`
				);
			};
		}

		// Baked at client-create time because the scheduler has no per-request
		// header hook.
		if (definitionGuid) {
			clientConfig.headers = { 'X-Selva-Definition': definitionGuid };
		}

		const client = await GrasshopperClient.create(clientConfig);

		const probe = createConcurrencyProbe(client, debugLog);
		await probe.refresh();

		const scheduler = client.createScheduler({
			mode: 'queue',
			// Queue mode defaults maxConcurrent to 1, serializing every solve on
			// this server through a single slot while the compute VM's other
			// compute.geometry children idle — always pass it explicitly.
			maxConcurrent: probe.maxConcurrent,
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
				// Deferred: this hook fires before the scheduler drops the solve from its in-flight set.
				queueMicrotask(() => finishDraining(entry));
				if (result.status !== 'success') return;
				// A cache hit means we never reached the server, so it says nothing about the pool.
				// `scheduler` is safe despite being referenced from inside its own initializer:
				// onSettle only ever fires during a solve, long after binding.
				if (result.fromCache !== true) probe.refreshIfDue(scheduler);
				if (config.debug) describeSettledSolve(result).forEach(debugLog);
			}
		});
		const entry: CachedClient = { client, scheduler };
		return entry;
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
			if (inFlight) return inFlight.promise;

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
			const token = { stale: false };
			const promise = (async () => {
				let entry: CachedClient;
				try {
					entry = await build(server, opts?.definitionGuid);
				} catch (err) {
					if (!token.stale) failed.set(key, { error: err, at: Date.now() });
					throw err;
				}

				// Installing it would carry the old URL or key past the eviction, with nothing left to
				// evict it again. Its caller holds a client built from those same details, so it fails too.
				if (token.stale) {
					entry.scheduler.dispose();
					throw new ComputeError(
						`Compute server ${key} changed while connecting.`,
						ErrorCodes.ABORTED
					);
				}

				if (cache.size >= maxWarmComputeServers) {
					const oldestKey = cache.keys().next().value;
					if (oldestKey !== undefined) {
						debugLog(
							`[Compute/client-cache] LRU evicted warm client for server ${oldestKey} (cap ${maxWarmComputeServers})`
						);
						const oldest = cache.get(oldestKey);
						cache.delete(oldestKey);
						if (oldest) retire(oldest);
					}
				}

				cache.set(key, entry);
				return entry;
			})().finally(() => {
				if (pending.get(key)?.token === token) pending.delete(key);
			});
			pending.set(key, { promise, token });
			return promise;
		},

		evict(id): void {
			// Drop any remembered failure too: `evict` means the connection details
			// changed, so the reason the last build failed no longer applies.
			failed.delete(id);
			const build = pending.get(id);
			if (build) {
				build.token.stale = true;
				pending.delete(id);
			}
			const entry = cache.get(id);
			if (entry) {
				debugLog(`[Compute/client-cache] evicted warm client for server ${id} (config change)`);
				cache.delete(id);
				retire(entry);
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
			for (const entry of [...cache.values(), ...draining]) entry.scheduler.dispose();
			for (const build of pending.values()) build.token.stale = true;
			pending.clear();
			cache.clear();
			draining.clear();
			failed.clear();
		}
	};
}
