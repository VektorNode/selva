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

import { NoopLogger, type ILogger } from '@selvajs/platform';

const MB = 1024 * 1024;

/** Env source: any string→string map. `$env/dynamic/private` satisfies this. */
export type EnvRecord = Record<string, string | undefined>;

/**
 * Optional structured logger for the env-parsing diagnostics below. Defaults to
 * `NoopLogger`: this is library code, so an embedder that wires nothing gets
 * silence rather than unsolicited stdout writes. The app passes its real logger.
 */
const noop = new NoopLogger();

/**
 * Parse a positive integer env value. Returns `fallback` when absent, and warns
 * + falls back when present but not a finite positive number.
 */
export function readPositiveInt(
	env: EnvRecord,
	name: string,
	fallback: number,
	logger: ILogger = noop
): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		logger.warn('Invalid env value, falling back to default', {
			component: 'selva',
			envVar: name,
			value: raw,
			fallback
		});
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
export function readNonNegativeInt(
	env: EnvRecord,
	name: string,
	fallback: number,
	logger: ILogger = noop
): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		logger.warn('Invalid env value, falling back to default', {
			component: 'selva',
			envVar: name,
			value: raw,
			fallback
		});
		return fallback;
	}
	return Math.floor(parsed);
}

/**
 * Read a renamed variable, honouring its previous name for one minor version.
 *
 * Returns the env map's value under `name`, or — when that is unset and the old
 * name is present — the old value plus a warning naming both. Setting both is not
 * an error: the new name wins silently, which is what an operator mid-migration
 * expects.
 *
 * This exists so a rename is never a silent behaviour change. A var that quietly
 * stops being read looks exactly like a var that is working, and the failure only
 * surfaces as a memory number nobody is watching.
 */
function readRenamed(env: EnvRecord, name: string, oldName: string, logger: ILogger): EnvRecord {
	if (env[name] !== undefined || env[oldName] === undefined) return env;
	logger.warn('Deprecated env var: rename it', {
		component: 'selva',
		envVar: oldName,
		renamedTo: name
	});
	return { ...env, [name]: env[oldName] };
}

/**
 * Parse a boolean env flag. Accepts `true/1/yes/on` (case-insensitive) as true
 * and `false/0/no/off` as false; any other / absent value falls back.
 */
export function readBool(
	env: EnvRecord,
	name: string,
	fallback: boolean,
	logger: ILogger = noop
): boolean {
	const raw = env[name];
	if (raw == null || raw === '') return fallback;
	const v = raw.trim().toLowerCase();
	if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
	if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
	logger.warn('Invalid env value, falling back to default', {
		component: 'selva',
		envVar: name,
		value: raw,
		fallback
	});
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
	/**
	 * TTL for the in-process cache of .gh bytes fetched from a REMOTE URL.
	 *
	 * Only the remote path is TTL'd, and the name says so deliberately: the other
	 * definition cache is keyed on an immutable version id, where expiry would be a
	 * bug (it can only ever throw away valid work). A URL's owner can swap the file
	 * underneath us, so that one needs a freshness bound and this is it.
	 */
	remoteDefinitionCacheTtlMs: number;
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
	 * Backpressure — max solves allowed to WAIT in the per-server FIFO queue (i.e.
	 * excluding the in-flight solves, capped at the scheduler's `maxConcurrent`,
	 * itself auto-detected from the compute server's active child count). A solve
	 * that arrives to a full queue is shed immediately (scheduler `QUEUE_FULL`,
	 * mapped to HTTP 503 + `Retry-After`) instead of piling up unbounded. `0` =
	 * unbounded (the pre-shedding default): the queue grows without limit,
	 * matching prior behavior. Size it to roughly 2–3× the compute server's
	 * child count once the Rhino pool's real capacity is known — shedding fast
	 * beats a hung request.
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
	 * **Definition cache** — total-byte budget (bytes) for the in-process cache of
	 * .gh bytes keyed on immutable version id. A warm entry lets a solve skip
	 * `storage.get` entirely, and a pointer-known solve never loads bytes at all.
	 * `0` disables it (every solve re-reads storage). A total-byte LRU rather than
	 * an entry count because definitions span KB→hundreds of MB. Env value is MB.
	 */
	computeDefinitionCacheBytes: number;
	/**
	 * **Solve cache** — total-byte budget (bytes) for EACH warm client's in-process
	 * cache of solve results (the `fromCache` layer in front of Rhino.Compute).
	 * Results range KB→100s of MB (`computeResponseMaxBytes` allows 300 MB), so an
	 * entry-count cap alone can't bound heap; this adds a byte LRU on top. `0`
	 * disables it (every solve goes to compute). Env value is MB.
	 *
	 * **This is per warm client, so the worst case multiplies.** Selva keeps up to
	 * `maxWarmComputeServers` (default 16) distinct compute servers warm, so the true
	 * ceiling is this × 16 — 4 GB at the default. Real deployments run 1–2 servers,
	 * which is why the default is comfortable, but a deployment that fans out
	 * across many servers on a small VPS is exactly the case this knob exists for.
	 */
	computeSolveCacheBytes: number;
}

/**
 * Resolve every server-side compute limit from an env map. Pure: the same env
 * always yields the same limits, and nothing is read ambiently. The app calls
 * this once at its composition root with `$env/dynamic/private`.
 */
export function resolveComputeLimits(env: EnvRecord, logger: ILogger = noop): ComputeLimits {
	// Renamed 2026-07 so each cache var says what it HOLDS. Old names still read,
	// with a boot warning; drop this shim one minor version on.
	env = readRenamed(env, 'COMPUTE_DEFINITION_CACHE_MB', 'COMPUTE_DEFINITION_BYTE_CACHE_MB', logger);
	env = readRenamed(env, 'COMPUTE_SOLVE_CACHE_MB', 'COMPUTE_RESPONSE_CACHE_MB', logger);
	env = readRenamed(env, 'REMOTE_DEFINITION_CACHE_TTL_MS', 'DEFINITION_CACHE_TTL_MS', logger);

	const maxGhFileSize = readPositiveInt(env, 'MAX_GH_FILE_SIZE_BYTES', 50 * MB, logger);
	return {
		maxSolveDurationMs: readPositiveInt(env, 'MAX_SOLVE_DURATION_MS', 100_000, logger),
		rateLimitWindowMs: readPositiveInt(env, 'COMPUTE_RATE_LIMIT_WINDOW_MS', 100_000, logger),
		rateLimitMaxRequests: readPositiveInt(env, 'COMPUTE_RATE_LIMIT_MAX', 120, logger),
		maxGhFileSize,
		maxImageFileSize: readPositiveInt(env, 'MAX_IMAGE_FILE_SIZE_BYTES', 10 * MB, logger),
		computeRequestMaxBytes: readPositiveInt(env, 'COMPUTE_REQUEST_MAX_BYTES', 210 * MB, logger),
		computeResponseMaxBytes: readPositiveInt(env, 'COMPUTE_RESPONSE_MAX_BYTES', 300 * MB, logger),
		// Tracks the upload cap so a remote URL can't smuggle a larger file.
		remoteDefinitionMaxBytes: maxGhFileSize,
		remoteDefinitionFetchTimeoutMs: readPositiveInt(
			env,
			'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
			30_000,
			logger
		),
		remoteDefinitionCacheTtlMs: readPositiveInt(
			env,
			'REMOTE_DEFINITION_CACHE_TTL_MS',
			5 * 60 * 1000,
			logger
		),
		computeReuseDefinitionCache: readBool(env, 'COMPUTE_REUSE_DEFINITION_CACHE', true, logger),
		computeServerCachesolve: readBool(env, 'COMPUTE_SERVER_CACHESOLVE', true, logger),
		computeCacheErroredSolves: readBool(env, 'COMPUTE_CACHE_ERRORED_SOLVES', false, logger),
		// Both 0 (unbounded / no deadline) by default — nothing sheds until an
		// operator who's measured their pool opts in. readNonNegativeInt so `0` is a
		// valid "disabled" value, not treated as invalid.
		computeMaxQueueDepth: readNonNegativeInt(env, 'COMPUTE_MAX_QUEUE_DEPTH', 0, logger),
		computeQueueWaitMs: readNonNegativeInt(env, 'COMPUTE_QUEUE_WAIT_MS', 0, logger),
		// Env is MB; 0 disables. Default 256 MB holds a handful of typical
		// definitions warm without pinning gigabytes. readNonNegativeInt so `0`
		// (disable) is honored rather than treated as invalid.
		computeDefinitionCacheBytes:
			readNonNegativeInt(env, 'COMPUTE_DEFINITION_CACHE_MB', 256, logger) * MB,
		// Per-warm-client solve cache budget. Env is MB; 0 disables it. Default
		// 256 MB: enough to keep a scrub session's recent solves warm without
		// letting worst-case entries pin gigabytes (audit C2). PER warm client —
		// see the field doc for the ×16 worst case.
		computeSolveCacheBytes: readNonNegativeInt(env, 'COMPUTE_SOLVE_CACHE_MB', 256, logger) * MB
	};
}
