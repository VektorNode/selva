/**
 * Compute/solve server limits, resolved from an injected env map.
 *
 * Env comes in as a parameter — nothing ambient is read — so this is importable
 * from any runtime and testable without env plumbing. Defaults are sized for
 * typical interactive use (sliders + small uploads).
 *
 * Client-side counterparts (the in-flight compute throttle and slider debounce)
 * are bundled into the client in `@selvajs/ui` and can't read env — they carry
 * their own defaults.
 */

import { NoopLogger, type ILogger } from '@selvajs/platform';

const MB = 1024 * 1024;

/**
 * Cap on a solve request body. A `file` input embeds geometry as base64, so the
 * client's 150 MB raw file is ~200 MB on the wire, plus JSON envelope slack.
 * adapter-node's `BODY_SIZE_LIMIT` must be at least this, or it rejects first.
 */
export const COMPUTE_REQUEST_MAX_BYTES = 256 * MB;

/** Env source: any string→string map. `$env/dynamic/private` satisfies this. */
export type EnvRecord = Record<string, string | undefined>;

/**
 * Default logger for the env-parsing warnings below. This is library code, so an
 * embedder that wires nothing gets silence rather than unsolicited stdout writes.
 */
const noop = new NoopLogger();

/** Parse a positive integer env value; absent, or present but not finite and positive, falls back. */
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

/** Like {@link readPositiveInt}, but `0` is valid — knobs where it means "disable". */
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
 * Fall back to a variable's previous name, warning when the old one is used.
 * Setting both is not an error: the new name wins silently, which is what an
 * operator mid-migration expects.
 *
 * A var that quietly stops being read looks exactly like one that is working —
 * the failure only surfaces as a memory number nobody is watching.
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
 * Parse a boolean env flag. Accepts `true/1/yes/on` and `false/0/no/off`
 * (case-insensitive); any other spelling warns and falls back.
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
	/** Fixed-window cap on /api/v1/compute: window length + max requests per window. */
	rateLimitWindowMs: number;
	rateLimitMaxRequests: number;
	/**
	 * Largest .gh definition accepted on upload. 50 MB matches Rhino.Compute's own
	 * `RHINO_COMPUTE_MAX_REQUEST_SIZE` default — a larger file 413s at compute
	 * regardless, so accepting it here only defers the failure.
	 */
	maxDefinitionFileSize: number;
	/** Largest cover image accepted on upload. */
	maxImageFileSize: number;
	/** /api/v1/compute JSON *request* body cap: {@link COMPUTE_REQUEST_MAX_BYTES}. */
	computeRequestMaxBytes: number;
	/**
	 * /api/v1/compute JSON *response* cap. A `file`-typed output is base64-embedded
	 * in the response; this guards V8's ~512 MB single-string wall (a
	 * `JSON.stringify` `RangeError`) and browser-tab OOM, turning an opaque crash
	 * into a clear 413. The real fix is out-of-band streaming.
	 *
	 * 300 MB is deliberate, not a dev leftover — above any legitimate inline
	 * payload, below the V8 string wall. Unlike the request cap it is not bounded
	 * by `BODY_SIZE_LIMIT`, which only covers inbound bodies.
	 */
	computeResponseMaxBytes: number;
	/**
	 * Hard cap on fetching a remote definition. Tracks `maxDefinitionFileSize` so a
	 * remote URL can't smuggle a file past the upload cap.
	 */
	remoteDefinitionMaxBytes: number;
	/** Deadline on fetching a remote definition (slow-loris protection). */
	remoteDefinitionFetchTimeoutMs: number;
	/**
	 * TTL for the in-process cache of .gh bytes fetched from a REMOTE URL.
	 *
	 * Only the remote path is TTL'd, and the name says so deliberately: the other
	 * definition cache is keyed on an immutable version id, where expiry could only
	 * ever throw away valid work. A URL's owner can swap the file underneath us, so
	 * that path needs a freshness bound and this is it.
	 */
	remoteDefinitionCacheTtlMs: number;
	/**
	 * Ask Rhino.Compute to cache solve RESULTS keyed on the full request and
	 * return a cached result on an identical repeat. Server-wide (survives Selva
	 * restarts, spans instances). Only helps IDENTICAL re-solves.
	 */
	computeServerCachesolve: boolean;
	/**
	 * Backpressure — max solves allowed to WAIT in the per-server FIFO queue. This
	 * excludes in-flight solves, which the scheduler caps at `maxConcurrent`,
	 * auto-detected from the compute server's active child count. A solve arriving
	 * at a full queue is rejected on the spot (scheduler `QUEUE_FULL` → HTTP 503 +
	 * `Retry-After`) instead of piling up. `0` = unbounded, the default.
	 *
	 * Size it to roughly 2–3× the compute server's child count once you know the
	 * Rhino pool's real capacity — rejecting fast beats a hung request.
	 */
	computeMaxQueueDepth: number;
	/**
	 * Backpressure — longest (ms) a solve may sit QUEUED before it starts
	 * executing. Still waiting past this, it's rejected (scheduler `QUEUE_TIMEOUT`
	 * → HTTP 503 + `Retry-After`) rather than burning compute on a stale request.
	 * `0` = no queue deadline, the default.
	 *
	 * Bounds tail latency: the scheduler's `timeoutMs` clock starts at execution,
	 * so without this a solve's total wait is unbounded and invisible. Tune it to
	 * about the compute server's own timeout.
	 */
	computeQueueWaitMs: number;
	/**
	 * **Definition cache** — total-byte budget for the in-process cache of .gh bytes
	 * keyed on immutable version id. A warm entry lets a solve skip `storage.get`;
	 * `0` disables it, so every solve re-reads storage. A byte LRU rather than an
	 * entry count because definitions span KB→hundreds of MB. Env value is MB.
	 */
	computeDefinitionCacheBytes: number;
	/**
	 * **Solve cache** — total-byte budget for EACH warm client's in-process cache of
	 * solve results (the `fromCache` layer in front of Rhino.Compute). `0` disables
	 * it, so every solve goes to compute. Results span KB→100s of MB
	 * (`computeResponseMaxBytes` allows 300 MB), so an entry count alone can't bound
	 * heap; this adds a byte LRU on top. Env value is MB.
	 *
	 * **Per warm client, so the worst case multiplies.** Selva keeps up to
	 * `maxWarmComputeServers` (default 16) compute servers warm, making the real
	 * ceiling this × 16 — 4 GB at the default. Most deployments run 1–2 servers,
	 * which is why the default is comfortable; a fan-out across many servers on a
	 * small VPS is the case this knob exists for.
	 */
	computeSolveCacheBytes: number;
}

/**
 * Resolve every server-side compute limit from an env map. The app calls this
 * once at its composition root with `$env/dynamic/private`.
 */
export function resolveComputeLimits(env: EnvRecord, logger: ILogger = noop): ComputeLimits {
	// Deprecation shims, so each var says what it HOLDS and what it bounds — one
	// solve — rather than a vague "duration". Drop one minor version on.
	env = readRenamed(env, 'COMPUTE_DEFINITION_CACHE_MB', 'COMPUTE_DEFINITION_BYTE_CACHE_MB', logger);
	env = readRenamed(env, 'COMPUTE_SOLVE_CACHE_MB', 'COMPUTE_RESPONSE_CACHE_MB', logger);

	// Clean-cut rename with no old-name dual-read: deliberate pre-1.0 breaking change.
	const maxDefinitionFileSize = readPositiveInt(
		env,
		'MAX_DEFINITION_FILE_SIZE_BYTES',
		50 * MB,
		logger
	);
	return {
		rateLimitWindowMs: 100_000,
		rateLimitMaxRequests: readPositiveInt(env, 'COMPUTE_RATE_LIMIT_MAX', 120, logger),
		maxDefinitionFileSize,
		maxImageFileSize: 10 * MB,
		computeRequestMaxBytes: COMPUTE_REQUEST_MAX_BYTES,
		computeResponseMaxBytes: 300 * MB,
		remoteDefinitionMaxBytes: maxDefinitionFileSize,
		remoteDefinitionFetchTimeoutMs: 30_000,
		remoteDefinitionCacheTtlMs: 5 * 60 * 1000,
		computeServerCachesolve: readBool(env, 'COMPUTE_SERVER_CACHESOLVE', true, logger),
		// Both default to off — nothing is rejected until an operator who has measured
		// their pool opts in. readNonNegativeInt throughout, so `0` reads as "disabled"
		// rather than as an invalid value that falls back.
		computeMaxQueueDepth: readNonNegativeInt(env, 'COMPUTE_MAX_QUEUE_DEPTH', 0, logger),
		computeQueueWaitMs: readNonNegativeInt(env, 'COMPUTE_QUEUE_WAIT_MS', 0, logger),
		// 256 MB holds a handful of typical definitions warm without pinning gigabytes.
		computeDefinitionCacheBytes:
			readNonNegativeInt(env, 'COMPUTE_DEFINITION_CACHE_MB', 256, logger) * MB,
		// 256 MB keeps a scrub session's recent solves warm; PER warm client, so see
		// the field doc for the ×16 worst case.
		computeSolveCacheBytes: readNonNegativeInt(env, 'COMPUTE_SOLVE_CACHE_MB', 256, logger) * MB
	};
}
