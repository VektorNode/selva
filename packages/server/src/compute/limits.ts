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
	 * past the upload cap.
	 */
	maxGhFileSize: number;
	maxImageFileSize: number;
	/**
	 * /api/compute JSON *request* body cap (inputs + values, not the .gh). A
	 * `file`-widget input embeds geometry as base64 in `values`; must stay <=
	 * the adapter-node global BODY_SIZE_LIMIT or the global backstop rejects first.
	 */
	computeRequestMaxBytes: number;
	/**
	 * /api/compute JSON *response* cap. A `file`-typed output is base64-embedded
	 * in the response; guards V8's ~512 MB single-string wall (a `JSON.stringify`
	 * `RangeError`) and browser-tab OOM. Defensive backstop → clear 413 instead of
	 * an opaque crash (real fix is out-of-band streaming, ADR 0003).
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
}

/**
 * Resolve every server-side compute limit from an env map. Pure: the same env
 * always yields the same limits, and nothing is read ambiently. The app calls
 * this once at its composition root with `$env/dynamic/private`.
 */
export function resolveComputeLimits(env: EnvRecord): ComputeLimits {
	const maxGhFileSize = readPositiveInt(env, 'MAX_GH_FILE_SIZE_BYTES', 300 * MB);
	return {
		maxSolveDurationMs: readPositiveInt(env, 'MAX_SOLVE_DURATION_MS', 100_000),
		rateLimitWindowMs: readPositiveInt(env, 'COMPUTE_RATE_LIMIT_WINDOW_MS', 100_000),
		rateLimitMaxRequests: readPositiveInt(env, 'COMPUTE_RATE_LIMIT_MAX', 120),
		maxGhFileSize,
		maxImageFileSize: readPositiveInt(env, 'MAX_IMAGE_FILE_SIZE_BYTES', 10 * MB),
		computeRequestMaxBytes: readPositiveInt(env, 'COMPUTE_REQUEST_MAX_BYTES', 300 * MB),
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
		computeCacheErroredSolves: readBool(env, 'COMPUTE_CACHE_ERRORED_SOLVES', false)
	};
}
