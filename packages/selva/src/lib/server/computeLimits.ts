/**
 * Thin adapter over `@selvajs/server`'s `resolveComputeLimits`: reads SvelteKit's
 * dynamic private env once and re-exports the resolved values as named constants.
 *
 * Uses `$env/dynamic/private`, not bare `process.env`: under `vite dev`, Vite
 * loads `.env` into this module but does NOT mirror it into `process.env`, so a
 * raw `process.env[name]` is undefined in dev and every knob silently falls back
 * to its default regardless of `.env`.
 *
 * Client-side counterparts (in-flight compute throttle, slider debounce) are
 * bundled into the client and can't read env — see `async-throttle.ts` in
 * `@selvajs/solve/client` and the input components.
 */

import { env } from '$env/dynamic/private';
import { resolveComputeLimits } from '@selvajs/server/compute';
// Limits resolve at module scope, before the pino swap — a captured logger
// would pin the boot placeholder, so this needs the forwarding one.
import { lazyLogger } from '$lib/server/providers.server';

// The logger surfaces malformed env values (e.g. a non-numeric
// COMPUTE_RATE_LIMIT_MAX silently falling back to its default).
const limits = resolveComputeLimits(env, lazyLogger);

/** The whole resolved object — passed wholesale to `SolveEngine` (`engine.server.ts`). */
export const computeLimits = limits;

// How long one solve may run — shared with the browser so the client's
// AbortController matches the server's deadline rather than guessing.
export const SOLVE_DEADLINE_MS = limits.solveDeadlineMs;

// Per-key compute rate limit (see computeRateLimit.server.ts).
export const RATE_LIMIT_WINDOW_MS = limits.rateLimitWindowMs;
export const RATE_LIMIT_MAX_REQUESTS = limits.rateLimitMaxRequests;

// Upload + payload caps; override per-deployment via the *_BYTES env vars.
// The Rhino.Compute server caps at RHINO_COMPUTE_MAX_REQUEST_SIZE (default
// 50 MB), so raising MAX_DEFINITION_FILE_SIZE past that only defers the 413
// to compute — raise it there too.
export const MAX_DEFINITION_FILE_SIZE = limits.maxDefinitionFileSize;
export const MAX_IMAGE_FILE_SIZE = limits.maxImageFileSize;

// /api/compute JSON request/response body caps. In a production (adapter-node)
// build these must stay <= the global BODY_SIZE_LIMIT or the global backstop
// rejects first; under vite dev it isn't enforced.
export const COMPUTE_REQUEST_MAX_BYTES = limits.computeRequestMaxBytes;
export const COMPUTE_RESPONSE_MAX_BYTES = limits.computeResponseMaxBytes;

// Remote-definition fetch caps (SSRF + slow-loris protection sits in safe-url).
export const REMOTE_DEFINITION_MAX_BYTES = limits.remoteDefinitionMaxBytes;
export const REMOTE_DEFINITION_FETCH_TIMEOUT_MS = limits.remoteDefinitionFetchTimeoutMs;

// TTL for the in-process cache of REMOTE-fetched .gh bytes. Only the remote path
// is TTL'd — the definition cache below is keyed on an immutable version id.
export const REMOTE_DEFINITION_CACHE_TTL_MS = limits.remoteDefinitionCacheTtlMs;

// Server definition-cache reuse (pointer instead of re-uploading the binary).
export const COMPUTE_REUSE_DEFINITION_CACHE = limits.computeReuseDefinitionCache;

// Server-side solve-result cache (`cachesolve`) + errored-solve caching opt-in.
export const COMPUTE_SERVER_CACHESOLVE = limits.computeServerCachesolve;
export const COMPUTE_CACHE_ERRORED_SOLVES = limits.computeCacheErroredSolves;

// Backpressure: queue-depth cap and queue-wait deadline. Both 0 = unbounded/off.
export const COMPUTE_MAX_QUEUE_DEPTH = limits.computeMaxQueueDepth;
export const COMPUTE_QUEUE_WAIT_MS = limits.computeQueueWaitMs;

// Definition cache — .gh bytes keyed on immutable version id. 0 disables.
export const COMPUTE_DEFINITION_CACHE_BYTES = limits.computeDefinitionCacheBytes;

// Solve cache — results, PER warm client (so the worst case is ×16). 0 disables.
export const COMPUTE_SOLVE_CACHE_BYTES = limits.computeSolveCacheBytes;
