/**
 * App-side binding for the compute limits. The knobs, defaults, and env
 * parsing now live in `@selvajs/server` (`resolveComputeLimits`) so a consuming
 * app can reuse them; this module is the thin adapter that reads SvelteKit's
 * dynamic private env ONCE and re-exports the resolved values as the named
 * constants the rest of the app already imports.
 *
 * Why `$env/dynamic/private` and not bare `process.env`: in `vite dev` Vite
 * loads `.env` into this module but does NOT mirror it into `process.env`, so a
 * raw `process.env[name]` is undefined in dev and every knob silently fell back
 * to its default regardless of `.env`.
 *
 * Client-side counterparts (the in-flight compute throttle and the slider
 * debounce on inputs) live in `@selvajs/ui` and are bundled into the client, so
 * they cannot read env — see `compute/computeThrottle.svelte.ts` and the input
 * components.
 */

import { env } from '$env/dynamic/private';
import { resolveComputeLimits } from '@selvajs/server/compute';

const limits = resolveComputeLimits(env);

// Maximum solve duration — single source of truth for the /api/compute timeout.
// See `@selvajs/server` `ComputeLimits.maxSolveDurationMs` for the full rationale
// (SolveScheduler AbortSignal propagation, reverse-proxy/platform caveat).
export const MAX_SOLVE_DURATION_MS = limits.maxSolveDurationMs;

// Per-key compute rate limit (see computeRateLimit.server.ts).
export const RATE_LIMIT_WINDOW_MS = limits.rateLimitWindowMs;
export const RATE_LIMIT_MAX_REQUESTS = limits.rateLimitMaxRequests;

// Upload + payload caps.
// TEMP (dev): defaults raised to 300 MB in `@selvajs/server` so large dev
// definitions don't hit the Selva-side gate. NOTE: the Rhino.Compute server
// still caps at RHINO_COMPUTE_MAX_REQUEST_SIZE (default 50 MB), so uploads past
// that 413 at compute regardless. Revert the package defaults to 50 MB / 210 MB
// before release (or set the *_BYTES env vars for this deployment).
export const MAX_GH_FILE_SIZE = limits.maxGhFileSize;
export const MAX_IMAGE_FILE_SIZE = limits.maxImageFileSize;

// /api/compute JSON request/response body caps. In a production (adapter-node)
// build these must stay <= the global BODY_SIZE_LIMIT or the global backstop
// rejects first; under vite dev it isn't enforced.
export const COMPUTE_REQUEST_MAX_BYTES = limits.computeRequestMaxBytes;
export const COMPUTE_RESPONSE_MAX_BYTES = limits.computeResponseMaxBytes;

// Remote-definition fetch caps (SSRF + slow-loris protection sits in safe-url).
export const REMOTE_DEFINITION_MAX_BYTES = limits.remoteDefinitionMaxBytes;
export const REMOTE_DEFINITION_FETCH_TIMEOUT_MS = limits.remoteDefinitionFetchTimeoutMs;

// In-process cache for remote-fetched .gh bytes.
export const DEFINITION_CACHE_TTL_MS = limits.definitionCacheTtlMs;

// Server definition-cache reuse (pointer instead of re-uploading the binary).
export const COMPUTE_REUSE_DEFINITION_CACHE = limits.computeReuseDefinitionCache;

// Server-side solve-result cache (`cachesolve`) + errored-solve caching opt-in.
export const COMPUTE_SERVER_CACHESOLVE = limits.computeServerCachesolve;
export const COMPUTE_CACHE_ERRORED_SOLVES = limits.computeCacheErroredSolves;

// Max in-flight solves per compute server (scheduler maxConcurrent) — size to
// the server's compute.geometry child count. See ComputeLimits for rationale.
export const COMPUTE_MAX_CONCURRENT = limits.computeMaxConcurrentSolves;
