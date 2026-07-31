import {
	GrasshopperClient,
	enableDebugLogging,
	type GrasshopperComputeConfig,
	type SolveScheduler
} from '@selvajs/compute';

// ============================================================================
// Shared compute client cache
// ============================================================================
//
// One warm `GrasshopperClient` (+ its `SolveScheduler`) per distinct compute
// server, keyed by the server's `id`, never its URL (ADR 0004) — a rotated
// URL/apiKey keeps the same key with stale connection details, so the
// config-write path MUST call `evict(id)` when a server's config changes.
//
// Deliberately a per-server LRU, not a single shared client: definitions can
// pin different servers, so two definitions on two servers keep two warm
// clients, with churn from one-off servers bounded by `maxCachedClients`.
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
	/** Sent as `RhinoComputeKey`. */
	apiKey?: string;
}

/** Derive the opaque cache identity from a resolved server. Identity is the `id`. */
export function serverIdentity(server: Pick<ResolvedServer, 'id'>): ServerIdentity {
	return server.id as ServerIdentity;
}

export interface CachedClient {
	client: GrasshopperClient;
	scheduler: SolveScheduler;
	/**
	 * Last Server-Timing decode/solve/encode, written by onServerTiming.
	 * The scheduler runs up to `maxConcurrentSolves` at once, so `last` alone
	 * can't be trusted per-request: callers snapshot `seq` before their solve
	 * and only attribute `last` to themselves if exactly one write happened
	 * since (see the guard in `runSolvePipeline`), dropping it otherwise
	 * rather than risk misattributing another request's timing.
	 */
	rhinoTiming: { last: { decode: number; solve: number; encode: number } | null; seq: number };
	/**
	 * Same snapshot-and-attribute pattern as `rhinoTiming`, for the scheduler's
	 * onSettle cache verdict. `seq` increments on every settle (success or
	 * error); `last` is written only on success.
	 */
	solveMeta: {
		last: { fromCache: boolean; definitionReuploaded?: boolean } | null;
		seq: number;
	};
}

/** Config injected by the consuming app, so this module stays env-agnostic and testable. */
export interface ClientCacheConfig {
	/** Per-solve timeout forwarded to the scheduler (`ComputeLimits.maxSolveDurationMs`). */
	maxSolveDurationMs: number;
	/** Ask Rhino.Compute to cache solve results and return them on identical repeats. */
	cachesolve: boolean;
	/** Also cache solves that reported GH errors (only meaningful with `cachesolve`). */
	cacheerroredsolves: boolean;
	/** Reference large definitions by server cache key (pointer) instead of re-uploading. */
	reuseServerDefinitionCache: boolean;
	/**
	 * Max in-flight solves per compute server (scheduler `maxConcurrent`; excess
	 * FIFO-queues). Size to the server's `compute.geometry` child count
	 * (`ComputeLimits.computeMaxConcurrentSolves`).
	 */
	maxConcurrentSolves: number;
	/**
	 * Backpressure — max solves that may WAIT in the FIFO queue (excludes the
	 * in-flight `maxConcurrentSolves`). `0` = unbounded (`ComputeLimits.
	 * computeMaxQueueDepth`); a full queue sheds new solves with `QUEUE_FULL`.
	 */
	maxQueueDepth: number;
	/**
	 * Backpressure — max ms a solve may sit queued before executing; `0` = no
	 * deadline (`ComputeLimits.computeQueueWaitMs`). A too-long wait sheds with
	 * `QUEUE_TIMEOUT`.
	 */
	queueWaitMs: number;
	/**
	 * Byte budget for this client's in-process solve cache, evicted LRU alongside
	 * its entry-count cap. Applies per warm client — total worst-case heap is this
	 * × `maxCachedClients`. `0` disables the cache entirely
	 * (`ComputeLimits.computeSolveCacheBytes`, env `COMPUTE_SOLVE_CACHE_MB`).
	 */
	responseCacheMaxBytes: number;
	/** Concise cache/timing logs. When false, `onDebugLog` is never invoked. */
	debug: boolean;
	/** VERBOSE lib-level logging (full solve request/response incl. geometry). */
	debugVerbose: boolean;
	/** Max distinct warm clients before the LRU evicts the oldest. Default 16. */
	maxCachedClients?: number;
	/** Sink for the concise debug lines (the app wires `console.log`). */
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
	/**
	 * Solve-cache counters summed across every warm client. `warmClients` is
	 * reported alongside since each client owns its own cache. Counters die
	 * with the client that owns them, so totals can fall over time.
	 */
	solveCacheStats(): SolveCacheStats;
	/** Dispose every warm client. Test seam / shutdown hook. */
	disposeAll(): void;
}

/** Aggregate solve-cache counters across the warm clients (see `solveCacheStats`). */
export interface SolveCacheStats {
	warmClients: number;
	entries: number;
	bytes: number;
	hits: number;
	misses: number;
	/** Entries dropped under size/byte pressure (not TTL expiry or replacement). */
	evictions: number;
}

const DEFAULT_MAX_CACHED_CLIENTS = 16;

export function createClientCache(config: ClientCacheConfig): ClientCache {
	const maxCachedClients = config.maxCachedClients ?? DEFAULT_MAX_CACHED_CLIENTS;
	const cache = new Map<string, CachedClient>();
	// Builds in flight, keyed like `cache`. Concurrent `getClient` calls for the
	// same id must share ONE build: without this, both miss, both handshake, and
	// the loser's entry is overwritten in the map without ever being disposed.
	const pending = new Map<string, Promise<CachedClient>>();

	if (config.debugVerbose) enableDebugLogging();

	const debugLog = (message: string) => {
		if (config.debug) config.onDebugLog?.(message);
	};

	async function build(server: ResolvedServer, definitionGuid?: string): Promise<CachedClient> {
		const rhinoTiming: CachedClient['rhinoTiming'] = { last: null, seq: 0 };
		const solveMeta: CachedClient['solveMeta'] = { last: null, seq: 0 };

		const clientConfig: GrasshopperComputeConfig = {
			serverUrl: server.serverUrl,
			apiKey: server.apiKey,
			// Lib-level debug is the verbose one (full payload logs); keep it on the
			// verbose flag so the concise cache logs can run without the noise.
			debug: config.debugVerbose,
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
		const scheduler = client.createScheduler({
			mode: 'queue',
			// Queue mode defaults maxConcurrent to 1, serializing every solve on
			// this server through a single slot while the compute VM's other
			// compute.geometry children idle — always pass it explicitly.
			maxConcurrent: config.maxConcurrentSolves,
			// The scheduler treats undefined as unbounded/no-deadline, so map our
			// `0`-means-off convention to undefined rather than passing 0 (which
			// would shed EVERY queued solve).
			maxQueueDepth: config.maxQueueDepth || undefined,
			queueWaitMs: config.queueWaitMs || undefined,
			timeoutMs: config.maxSolveDurationMs,
			cache:
				config.responseCacheMaxBytes > 0
					? { maxEntries: 20, ttlMs: 5 * 60_000, maxBytes: config.responseCacheMaxBytes }
					: false,
			reuseServerDefinitionCache: config.reuseServerDefinitionCache,
			onSettle: (_ctx, result) => {
				solveMeta.seq += 1;
				if (result.status !== 'success') return;
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

			// A build is a Rhino.Compute handshake — expensive, and repeated builds for
			// the same id mean churn (LRU thrash or config-rotation evictions).
			debugLog(`[Compute/client-cache] miss — building warm client for server ${key}`);
			const buildPromise = (async () => {
				const entry = await build(server, opts?.definitionGuid);

				if (cache.size >= maxCachedClients) {
					const oldestKey = cache.keys().next().value;
					if (oldestKey !== undefined) {
						debugLog(
							`[Compute/client-cache] LRU evicted warm client for server ${oldestKey} (cap ${maxCachedClients})`
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

		disposeAll(): void {
			debugLog(`[Compute/client-cache] disposing all ${cache.size} warm client(s)`);
			for (const entry of cache.values()) entry.scheduler.dispose();
			cache.clear();
		}
	};
}
