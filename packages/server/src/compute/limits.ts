/**
 * Compute/solve server limits, resolved from an injected env map.
 *
 * This is the transport- and framework-agnostic core: it takes a plain
 * `Record<string, string | undefined>` (the caller passes SvelteKit's
 * `$env/dynamic/private`, `process.env`, or any config source) and returns a
 * fully-resolved `ComputeLimits` object. No ambient `$env` / `process.env`
 * read happens here, so the module is importable from any runtime and testable
 * without env plumbing.
 *
 * Every knob is env-overridable so deployments can tune without code changes;
 * the defaults are sized for typical interactive use (sliders + small uploads).
 * Centralizing them surfaces the tradeoffs (raise the rate cap → also consider
 * the body cap) at one glance.
 *
 * Client-side counterparts (the in-flight compute throttle and slider debounce)
 * live in `@selvajs/ui` and are bundled into the client, so they can't read
 * env — they carry their own defaults.
 */

const MB = 1024 * 1024;

/** Env source: any string→string map. `$env/dynamic/private` satisfies this. */
export type EnvRecord = Record<string, string | undefined>;

/**
 * Parse a positive integer env value. Returns `fallback` when absent, and warns
 * + falls back when present but not a finite positive number.
 */
export function readPositiveInt(env: EnvRecord, name: string, fallback: number): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.warn(`[selva] Invalid ${name}=${raw}, falling back to ${fallback}`);
		return fallback;
	}
	return Math.floor(parsed);
}

/**
 * Parse a non-negative integer env value — like {@link readPositiveInt} but `0`
 * is a valid value (used by knobs where `0` means "disable", e.g. a cache
 * budget). Returns `fallback` when absent, and warns + falls back when present
 * but not a finite non-negative number.
 */
export function readNonNegativeInt(env: EnvRecord, name: string, fallback: number): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		console.warn(`[selva] Invalid ${name}=${raw}, falling back to ${fallback}`);
		return fallback;
	}
	return Math.floor(parsed);
}

/**
 * Parse a boolean env flag. Accepts `true/1/yes/on` (case-insensitive) as true
 * and `false/0/no/off` as false; any other / absent value falls back.
 */
export function readBool(env: EnvRecord, name: string, fallback: boolean): boolean {
	const raw = env[name];
	if (raw == null || raw === '') return fallback;
	const v = raw.trim().toLowerCase();
	if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
	if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
	console.warn(`[selva] Invalid ${name}=${raw}, falling back to ${fallback}`);
	return fallback;
}

/** Fully-resolved server-side compute limits. */
export interface ComputeLimits {
	/**
	 * Longest the app waits for one solve. Enforced by the SolveScheduler
	 * (`@selvajs/compute`), which propagates AbortSignal into the upstream
	 * Compute call — a timeout actually cancels the work. Forwarded to the
	 * client to drive the in-browser AbortController.
	 *
	 * Caveat: bounds only the parts of the stack we own. A reverse proxy or
	 * serverless platform cap may shoot the request sooner; bumping past those
	 * caps produces 502s, not longer solves.
	 */
	maxSolveDurationMs: number;
	/** Fixed-window cap on /api/compute: window length + max requests per window. */
	rateLimitWindowMs: number;
	rateLimitMaxRequests: number;
	/**
	 * Largest .gh definition accepted on upload AND the largest remote definition
	 * fetched for compute — kept in lockstep so a remote URL can't smuggle a file
	 * past the upload cap. Defaults to 50 MB to match Rhino.Compute's own
	 * `RHINO_COMPUTE_MAX_REQUEST_SIZE` default: a larger file 413s at compute
	 * regardless, so accepting it here only defers the failure.
	 */
	maxGhFileSize: number;
	maxImageFileSize: number;
	/**
	 * /api/compute JSON *request* body cap (inputs + values, not the .gh). A
	 * `file`-widget input embeds geometry as base64 in `values`; must stay <=
	 * the adapter-node global BODY_SIZE_LIMIT or the global backstop rejects first.
	 * Defaults to 210 MB: the client allows a 150 MB raw file, base64 inflates it
	 * to ~200 MB on the wire, plus JSON envelope slack — and it matches the
	 * `BODY_SIZE_LIMIT=210M` shipped in `.env.example`.
	 */
	computeRequestMaxBytes: number;
	/**
	 * /api/compute JSON *response* cap. A `file`-typed output is base64-embedded
	 * in the response; guards V8's ~512 MB single-string wall (a `JSON.stringify`
	 * `RangeError`) and browser-tab OOM. Defensive backstop → clear 413 instead of
	 * an opaque crash (real fix is out-of-band streaming, ADR 0003).
	 *
	 * 300 MB is intentional and NOT a dev leftover — sized above any legitimate
	 * inline payload but below the V8 string wall. Unlike the request cap it is
	 * not bounded by BODY_SIZE_LIMIT, which only applies to inbound bodies.
	 */
	computeResponseMaxBytes: number;
	/** Hard cap on fetching a remote definition — tracks `maxGhFileSize`. */
	remoteDefinitionMaxBytes: number;
	/** Deadline on fetching a remote definition (slow-loris protection). */
	remoteDefinitionFetchTimeoutMs: number;
	/** In-process cache TTL for remote-fetched .gh bytes. */
	definitionCacheTtlMs: number;
	/**
	 * Reuse the server's cached definition via a pointer instead of re-uploading
	 * the binary each solve. SAFE only on a compute server that signals a
	 * stale-pointer miss (VektorNode fork / a fork that throws) — a server that
	 * returns an empty 200 would silently yield EMPTY geometry. Off for unknown
	 * / standard rhino.compute.
	 */
	computeReuseDefinitionCache: boolean;
	/**
	 * Ask Rhino.Compute to cache solve RESULTS keyed on the full request and
	 * return a cached result on an identical repeat. Server-wide (survives Selva
	 * restarts, spans instances). Only helps IDENTICAL re-solves.
	 */
	computeServerCachesolve: boolean;
	/**
	 * Also cache solves that reported Grasshopper errors — correct for
	 * error-by-design definitions (guarded Python, pruned branches) that still
	 * produce valid geometry. Requires `computeServerCachesolve` and a server
	 * honoring the flag. Conservative default off.
	 */
	computeCacheErroredSolves: boolean;
	/**
	 * Max in-flight solves this app instance sends to ONE compute server
	 * (forwarded as the SolveScheduler's `maxConcurrent`; excess solves FIFO-queue).
	 * Size it to the server's `compute.geometry` child count — Rhino.Compute
	 * spawns N children per VM precisely to run N solves concurrently, and a
	 * lower value idles that capacity while users queue (audit B6: the scheduler's
	 * queue-mode default is 1, which serialized ALL solves per server). Multiple
	 * app instances each apply their own cap.
	 */
	computeMaxConcurrentSolves: number;
	/**
	 * Backpressure — max solves allowed to WAIT in the per-server FIFO queue (i.e.
	 * excluding the `computeMaxConcurrentSolves` already in flight). A solve that
	 * arrives to a full queue is shed immediately (scheduler `QUEUE_FULL`, mapped
	 * to HTTP 503 + `Retry-After`) instead of piling up unbounded. `0` = unbounded
	 * (the pre-shedding default): the queue grows without limit, matching prior
	 * behavior. Size it to roughly 2–3× `computeMaxConcurrentSolves` once the
	 * Rhino pool's real capacity is known — shedding fast beats a hung request.
	 */
	computeMaxQueueDepth: number;
	/**
	 * Backpressure — longest (ms) a solve may sit QUEUED before it starts
	 * executing; still-waiting past this it's shed (scheduler `QUEUE_TIMEOUT` →
	 * HTTP 503 + `Retry-After`) rather than burning compute on a stale request.
	 * Bounds tail latency: the scheduler's `timeoutMs` clock starts at execution,
	 * so without this a solve's total wait is unbounded and invisible. `0` = no
	 * queue deadline (the default). A sensible tuned value is ≈ `maxSolveDurationMs`.
	 */
	computeQueueWaitMs: number;
	/**
	 * Total-byte budget (bytes) for the in-process definition-byte cache keyed on
	 * immutable version id. A warm entry lets a solve skip `storage.get` entirely,
	 * and a pointer-known solve never loads bytes at all. `0` disables the cache
	 * (every solve re-reads storage). Sized as a total-byte LRU because definitions
	 * span KB→hundreds of MB; env value is MB, converted here.
	 */
	computeDefinitionByteCacheBytes: number;
	/**
	 * Total-byte budget (bytes) for EACH warm client's in-process solve-response
	 * cache (the scheduler L1 — the `fromCache` layer in front of Rhino.Compute).
	 * Responses range KB→100s of MB (`computeResponseMaxBytes` allows 300 MB), so
	 * the L1's entry-count cap alone can't bound heap; this adds a byte LRU on
	 * top. Applies PER warm client — worst-case heap is this × the number of
	 * distinct compute servers kept warm (`maxCachedClients`, default 16), though
	 * real deployments run 1–2 servers. `0` disables the L1 response cache
	 * entirely (every solve goes to compute or the L2). Env value is MB.
	 */
	computeResponseCacheBytes: number;
	/**
	 * Default per-definition entry quota for the durable L2 solve cache (H1), used
	 * when a definition's `solveCacheLimit` is absent (inherit). A definition may
	 * override this; `0` on the definition turns caching off for it. This global
	 * default `0` means the L2 is effectively off until an operator sets a quota —
	 * safe because the memory backend also ships only under
	 * `SOLVE_CACHE_PROVIDER=memory`. Counts, not bytes: authors think in "how many
	 * solves to remember"; the byte backstop below is the operator's memory guard.
	 */
	solveCacheDefaultMaxEntries: number;
	/**
	 * Global byte backstop (bytes) across ALL definitions' L2 entries, evicted
	 * global-LRU regardless of per-definition counts. Entries range KB→100s of MB,
	 * so a count quota alone can't bound memory. `0` disables the backstop (rely on
	 * per-definition counts only — not recommended in the memory backend). Env value
	 * is MB, converted here. On Redis this moves to `maxmemory allkeys-lru`.
	 */
	solveCacheMaxTotalBytes: number;
}

/**
 * Resolve every server-side compute limit from an env map. Pure: the same env
 * always yields the same limits, and nothing is read ambiently. The app calls
 * this once at its composition root with `$env/dynamic/private`.
 */
export function resolveComputeLimits(env: EnvRecord): ComputeLimits {
	const maxGhFileSize = readPositiveInt(env, 'MAX_GH_FILE_SIZE_BYTES', 50 * MB);
	return {
		maxSolveDurationMs: readPositiveInt(env, 'MAX_SOLVE_DURATION_MS', 100_000),
		rateLimitWindowMs: readPositiveInt(env, 'COMPUTE_RATE_LIMIT_WINDOW_MS', 100_000),
		rateLimitMaxRequests: readPositiveInt(env, 'COMPUTE_RATE_LIMIT_MAX', 120),
		maxGhFileSize,
		maxImageFileSize: readPositiveInt(env, 'MAX_IMAGE_FILE_SIZE_BYTES', 10 * MB),
		computeRequestMaxBytes: readPositiveInt(env, 'COMPUTE_REQUEST_MAX_BYTES', 210 * MB),
		computeResponseMaxBytes: readPositiveInt(env, 'COMPUTE_RESPONSE_MAX_BYTES', 300 * MB),
		// Tracks the upload cap so a remote URL can't smuggle a larger file.
		remoteDefinitionMaxBytes: maxGhFileSize,
		remoteDefinitionFetchTimeoutMs: readPositiveInt(
			env,
			'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
			30_000
		),
		definitionCacheTtlMs: readPositiveInt(env, 'DEFINITION_CACHE_TTL_MS', 5 * 60 * 1000),
		computeReuseDefinitionCache: readBool(env, 'COMPUTE_REUSE_DEFINITION_CACHE', true),
		computeServerCachesolve: readBool(env, 'COMPUTE_SERVER_CACHESOLVE', true),
		computeCacheErroredSolves: readBool(env, 'COMPUTE_CACHE_ERRORED_SOLVES', false),
		// 4 matches rhino.compute's default --childcount; tune to the actual VM.
		computeMaxConcurrentSolves: readPositiveInt(env, 'COMPUTE_MAX_CONCURRENT', 4),
		// Both 0 (unbounded / no deadline) by default — nothing sheds until an
		// operator who's measured their pool opts in. readNonNegativeInt so `0` is a
		// valid "disabled" value, not treated as invalid.
		computeMaxQueueDepth: readNonNegativeInt(env, 'COMPUTE_MAX_QUEUE_DEPTH', 0),
		computeQueueWaitMs: readNonNegativeInt(env, 'COMPUTE_QUEUE_WAIT_MS', 0),
		// Env is MB; 0 disables. Default 256 MB holds a handful of typical
		// definitions warm without pinning gigabytes. readNonNegativeInt so `0`
		// (disable) is honored rather than treated as invalid.
		computeDefinitionByteCacheBytes:
			readNonNegativeInt(env, 'COMPUTE_DEFINITION_BYTE_CACHE_MB', 256) * MB,
		// Per-warm-client L1 response cache budget. Env is MB; 0 disables the L1.
		// Default 256 MB: enough to keep a scrub session's recent responses warm
		// without letting 20 × 300 MB worst-case entries pin gigabytes (audit C2).
		computeResponseCacheBytes: readNonNegativeInt(env, 'COMPUTE_RESPONSE_CACHE_MB', 256) * MB,
		// L2 durable solve cache (H1). Default per-definition quota 0 = inherit-to-off
		// until an operator opts in; the memory backend also only mounts under
		// SOLVE_CACHE_PROVIDER=memory, so nothing caches by accident. Byte backstop
		// 512 MB caps total heap use across all definitions (env is MB).
		solveCacheDefaultMaxEntries: readNonNegativeInt(env, 'SOLVE_CACHE_DEFAULT_MAX_ENTRIES', 0),
		solveCacheMaxTotalBytes: readNonNegativeInt(env, 'SOLVE_CACHE_MAX_TOTAL_MB', 512) * MB
	};
}
