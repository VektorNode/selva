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
// server, keyed by the server's **`id`** (ADR 0004 — a server's identity is its
// `id`, never its URL). Definitions can pin different servers (the app's
// `resolveServerForOrg` honors a per-definition pin → org default → global
// default), so this is deliberately a per-server LRU, NOT a single shared
// client — two definitions on two servers keep two warm clients; a churn of
// one-off servers is bounded by `maxCachedClients`.
//
// Both hot paths share this cache:
//   - the solve endpoint uses the entry's `scheduler`;
//   - the definition-viewer render path uses the entry's `client` for `getIO`.
// Sharing means a definition that was just solved renders from the same warm
// client (and vice-versa) instead of re-handshaking Rhino.Compute per page load.
//
// Staleness: keyed on `id`, a rotated URL/apiKey keeps the SAME key with stale
// connection details — so the config-write path MUST call `evict(id)` when a
// server's config changes (ADR 0004 Consequences). That replaces the old
// implicit "new key → LRU age-out" staleness the URL-keyed cache relied on.

/**
 * Opaque identity of a compute server. Callers never construct the branded
 * string directly — they pass a resolved server config to `serverIdentity()`.
 * Keeping this opaque from day one (ADR 0004 D1) means "a server is now a pool
 * of URLs behind one id" stays an additive, non-breaking change.
 */
export type ServerIdentity = string & { readonly __brand: 'ServerIdentity' };

/** Minimal resolved-server shape the cache needs (a subset of the app's `ComputeServerConfig`). */
export interface ResolvedServer {
	/** Stable identity — the cache key. */
	id: string;
	/** Base URL of the Rhino.Compute instance (a resolution detail of `id`). */
	serverUrl: string;
	/** Sent as `RhinoComputeKey`. */
	apiKey?: string;
}

/** Derive the opaque cache identity from a resolved server. Identity is the `id`. */
export function serverIdentity(server: Pick<ResolvedServer, 'id'>): ServerIdentity {
	return server.id as ServerIdentity;
}

/**
 * Per-request telemetry holders read by the caller right after a solve resolves
 * to build a Server-Timing header. Populated by the client/scheduler callbacks.
 */
export interface CachedClient {
	client: GrasshopperClient;
	scheduler: SolveScheduler;
	/**
	 * Last decode/solve/encode reported by the compute server (Server-Timing),
	 * written by onServerTiming. `seq` increments on every write. The scheduler
	 * runs up to `maxConcurrentSolves` solves at once, so `last` alone can't be
	 * trusted per-request: callers snapshot `seq` before their solve and
	 * attribute `last` only when exactly one write happened since (necessarily
	 * theirs — see the guard in `runSolvePipeline`), dropping the segment
	 * otherwise instead of misattributing another request's timing.
	 */
	rhinoTiming: { last: { decode: number; solve: number; encode: number } | null; seq: number };
	/**
	 * Last solve's cache verdicts from the scheduler's onSettle: whether the
	 * in-process response cache served it (no compute call) and whether the
	 * definition had to be re-uploaded. `seq` increments on EVERY settle
	 * (success or error); `last` is only written on success. Same
	 * snapshot-and-attribute pattern as rhinoTiming — onSettle always fires
	 * before the corresponding `scheduler.solve()` promise resolves, so at the
	 * caller's read point its own settle is included in `seq`.
	 */
	solveMeta: {
		last: { fromCache: boolean; definitionReuploaded?: boolean } | null;
		seq: number;
	};
}

/**
 * Config injected by the consuming app. Everything that used to be read from
 * `$env` / `computeLimits` in the app module is passed in, so this module stays
 * env-agnostic and testable.
 */
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
	 * inert routing/telemetry metadata until a pool router exists (ADR 0004 D2).
	 */
	getClient(server: ResolvedServer, opts?: { definitionGuid?: string }): Promise<CachedClient>;
	/**
	 * Dispose and drop the warm client for `id` (or a `ServerIdentity`). Called by
	 * the config-write path when a server's URL/key rotates so the next request
	 * rebuilds against fresh connection details (ADR 0004 Consequences).
	 */
	evict(id: string | ServerIdentity): void;
	/** Dispose every warm client. Test seam / shutdown hook. */
	disposeAll(): void;
}

const DEFAULT_MAX_CACHED_CLIENTS = 16;

/**
 * Build a per-server warm-client cache. Each cache owns its own LRU `Map` keyed
 * on server `id`.
 */
export function createClientCache(config: ClientCacheConfig): ClientCache {
	const maxCachedClients = config.maxCachedClients ?? DEFAULT_MAX_CACHED_CLIENTS;
	const cache = new Map<string, CachedClient>();

	if (config.debugVerbose) enableDebugLogging();

	const debugLog = (message: string) => {
		if (config.debug) config.onDebugLog?.(message);
	};

	async function build(server: ResolvedServer, definitionGuid?: string): Promise<CachedClient> {
		// Holders for per-request results from the client/scheduler callbacks; the
		// caller reads them right after each solve resolves to build Server-Timing,
		// using the seq counters to detect (and drop) ambiguous concurrent writes.
		const rhinoTiming: CachedClient['rhinoTiming'] = { last: null, seq: 0 };
		const solveMeta: CachedClient['solveMeta'] = { last: null, seq: 0 };

		const clientConfig: GrasshopperComputeConfig = {
			serverUrl: server.serverUrl,
			apiKey: server.apiKey,
			// Lib-level debug is the verbose one (full payload logs); keep it on the
			// verbose flag so the concise cache logs can run without the noise.
			debug: config.debugVerbose,
			// Ask Rhino.Compute to cache solve results and return them on identical
			// repeats (same definition + inputs), skipping the solve.
			cachesolve: config.cachesolve,
			// Opt-in: also cache solves that reported GH errors.
			cacheerroredsolves: config.cacheerroredsolves,
			// DEBUG: the server's per-request timing breakdown, which exposes the two
			// SERVER-side caches at once — definition cache (pointer reuse) via
			// `decode`, solve cache (cachesolve) via `solve`. Flagged below so the
			// contrast is obvious in the logs.
			onServerTiming: (t) => {
				const decode = t.decode ?? 0;
				const solve = t.solve ?? 0;
				const encode = t.encode ?? 0;
				// Always recorded (cheap): the caller reads this after scheduler.solve.
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

		// `X-Selva-Definition` on the wire (ADR 0004 D2). Baked at client-create
		// time because the scheduler has no per-request header hook — inert for a
		// single-member "pool", useful in compute-side access logs immediately.
		if (definitionGuid) {
			clientConfig.headers = { 'X-Selva-Definition': definitionGuid };
		}

		const client = await GrasshopperClient.create(clientConfig);
		const scheduler = client.createScheduler({
			mode: 'queue',
			// Queue mode defaults maxConcurrent to 1, which would serialize every
			// solve on this server through a single slot while the compute VM's
			// other compute.geometry children idle (audit B6) — always pass it.
			maxConcurrent: config.maxConcurrentSolves,
			// Backpressure (audit B7). The scheduler treats undefined as
			// unbounded/no-deadline, so map our `0`-means-off convention to undefined
			// rather than passing 0 (which would shed EVERY queued solve).
			maxQueueDepth: config.maxQueueDepth || undefined,
			queueWaitMs: config.queueWaitMs || undefined,
			timeoutMs: config.maxSolveDurationMs,
			cache: { maxEntries: 20, ttlMs: 5 * 60_000 },
			// Solve large definitions by server cache-key (pointer) instead of
			// re-uploading the full binary every solve. On a stale-pointer miss the
			// client transparently re-uploads.
			reuseServerDefinitionCache: config.reuseServerDefinitionCache,
			// DEBUG: observe the in-process response cache. `fromCache === true` means
			// this solve was served from the app's own cache — Rhino.Compute was never
			// called. `false` means it went to the compute server.
			onSettle: (_ctx, result) => {
				// Count EVERY settle (success or error) so the caller's attribution
				// guard sees all concurrent activity, not just successful writes.
				solveMeta.seq += 1;
				if (result.status !== 'success') return;
				// Always recorded (cheap): the caller surfaces these on Server-Timing.
				solveMeta.last = {
					fromCache: result.fromCache === true,
					definitionReuploaded: result.definitionReuploaded
				};
				if (!config.debug) return;
				debugLog(
					`[Compute/selva-cache] ${result.fromCache ? 'HIT  — served from cache (no compute call)' : 'miss — went to Rhino.Compute'} (${Math.round(result.durationMs)}ms)`
				);
				// Definition-cache verdict for a real compute call (not a cache HIT).
				if (!result.fromCache) {
					debugLog(
						result.definitionReuploaded === true
							? '[Compute/def-cache] miss — definition RE-UPLOADED (pointer was cold/stale)'
							: result.definitionReuploaded === false
								? '[Compute/def-cache] HIT  — definition reused from server cache (no upload)'
								: '[Compute/def-cache] n/a — reuse disabled or non-reusable definition'
					);
				}
				// Surface real GH errors when present. Whether an errored solve is cached is
				// config-gated by `cacheerroredsolves` (default false → errored solves are
				// re-run each time; true → the error result is cached like any other, per R2).
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

			// A build is a Rhino.Compute handshake — expensive, and repeated builds for
			// the same id mean churn (LRU thrash or config-rotation evictions).
			debugLog(`[Compute/client-cache] miss — building warm client for server ${key}`);
			const entry = await build(server, opts?.definitionGuid);

			// Evict the least-recently-used entry before inserting when at capacity.
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

		disposeAll(): void {
			debugLog(`[Compute/client-cache] disposing all ${cache.size} warm client(s)`);
			for (const entry of cache.values()) entry.scheduler.dispose();
			cache.clear();
		}
	};
}
