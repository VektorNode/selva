/**
 * Single source of truth for selva app server-side limits. Every knob below
 * is env-overridable so deployments can tune without code changes; the
 * defaults are sized for typical interactive use (sliders + small uploads).
 *
 * Why one module: these caps used to live next to their usages (rate limit,
 * upload caps, body cap, remote-fetch cap, cache TTL). When a single user-
 * facing scenario — e.g. "slider scrubbing got me throttled" — needs a tweak,
 * having to touch four files is friction. Centralizing also surfaces the
 * tradeoffs (raise the rate cap → also consider the body cap, etc.) at one
 * glance.
 *
 * Client-side counterparts (the in-flight compute throttle and the slider
 * debounce on inputs) live in `@selvajs/ui` and are bundled into the client,
 * so they cannot read process.env. The throttle is in
 * `compute/computeThrottle.svelte.ts`; per-input debounce values live with the
 * input components themselves.
 */

import { env } from '$env/dynamic/private';

function readPositiveInt(name: string, fallback: number): number {
	// Read via SvelteKit's dynamic private env, not bare `process.env`: in
	// `vite dev` Vite loads `.env` into this module but does NOT mirror it into
	// `process.env`, so a raw `process.env[name]` is undefined in dev and every
	// knob silently fell back to its default regardless of `.env`.
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.warn(`[computeLimits] Invalid ${name}=${raw}, falling back to ${fallback}`);
		return fallback;
	}
	return Math.floor(parsed);
}

/**
 * Read a boolean env flag. Accepts `true/1/yes/on` (case-insensitive) as true and
 * `false/0/no/off` as false; any other / absent value falls back. Uses the same
 * dynamic private env as {@link readPositiveInt} so `.env` works under `vite dev`.
 */
function readBool(name: string, fallback: boolean): boolean {
	const raw = env[name];
	if (raw == null || raw === '') return fallback;
	const v = raw.trim().toLowerCase();
	if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
	if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
	console.warn(`[computeLimits] Invalid ${name}=${raw}, falling back to ${fallback}`);
	return fallback;
}

const MB = 1024 * 1024;

// ============================================================================
// Maximum solve duration (single source of truth for /api/compute timeout)
// ============================================================================
// The longest the app will wait for one solve. Enforced by the
// SolveScheduler (`@selvajs/compute`), which propagates AbortSignal into
// the upstream Compute call — so a timeout actually cancels the work
// instead of orphaning it. The same value is forwarded to the client via
// page data and drives the in-browser AbortController in
// `createComputeThrottle`.
//
// Caveat: this knob bounds only the parts of the stack we own. A reverse
// proxy (`read_timeout`) or serverless platform cap may shoot the request
// sooner; bumping this past those caps will produce 502s, not longer
// solves. See `.env.example` for the deployment-side guidance.
export const MAX_SOLVE_DURATION_MS = readPositiveInt('MAX_SOLVE_DURATION_MS', 100_000);

// ============================================================================
// Per-key compute rate limit (see computeRateLimit.server.ts)
// ============================================================================
// Fixed-window cap on /api/compute. Default 120 / 100s ≈ 1.2 solves/sec
// sustained, well above what slider scrubbing produces in practice (one-in-
// flight throttle + 150ms slider debounce ≈ 6/sec peak only when solves are
// <50ms; in steady state the cap is rarely touched). If you raise
// MAX_SOLVE_DURATION_MS for long-running definitions, the rate cap rarely needs
// to move with it (each long solve is one request, not many).
export const RATE_LIMIT_WINDOW_MS = readPositiveInt('COMPUTE_RATE_LIMIT_WINDOW_MS', 100_000);
export const RATE_LIMIT_MAX_REQUESTS = readPositiveInt('COMPUTE_RATE_LIMIT_MAX', 120);

// ============================================================================
// Upload + payload caps
// ============================================================================
// Largest .gh definition we accept on upload AND the largest remote definition
// we'll fetch for compute. Kept in lockstep deliberately — a remote URL must
// not be a way to smuggle a file past the upload cap.
// TEMP (dev): raised 50 MB → 300 MB so large dev definitions don't hit the
// Selva-side gate. NOTE: the Rhino.Compute server still caps at its own
// RHINO_COMPUTE_MAX_REQUEST_SIZE (default 50 MB), so uploads past that 413 at
// compute regardless of this value. Revert to 50 * MB before release.
export const MAX_GH_FILE_SIZE = readPositiveInt('MAX_GH_FILE_SIZE_BYTES', 300 * MB);
export const MAX_IMAGE_FILE_SIZE = readPositiveInt('MAX_IMAGE_FILE_SIZE_BYTES', 10 * MB);

// /api/compute JSON body cap. This is inputs + values, not the .gh. Most
// payloads are tens of KB (sliders + dropdowns), BUT a `file` widget input
// embeds the uploaded geometry as base64 inside `values` — and base64 inflates
// raw bytes by ~4/3. The client file cap is APP_DEFAULTS.FILE_UPLOAD (150 MB
// raw, in @selvajs/ui), so a worst-case body is ~200 MB. We size to 210 MB to
// clear that plus JSON envelope slack. NOTE: this must stay <= the global
// BODY_SIZE_LIMIT (adapter-node), or the global backstop rejects first.
// TEMP (dev): raised 210 MB → 300 MB. In a production (adapter-node) build,
// also bump BODY_SIZE_LIMIT to >= 300M or the global cap rejects first; under
// vite dev it isn't enforced. Revert to 210 * MB before release.
export const COMPUTE_REQUEST_MAX_BYTES = readPositiveInt('COMPUTE_REQUEST_MAX_BYTES', 300 * MB);

// /api/compute JSON *response* cap — the missing counterpart to the request
// cap above. A `file`-typed output (e.g. an exported .3dm) is base64-embedded
// in the solve response; real definitions produce 250+ MB exports. Two failure
// modes this guards: (1) V8 caps a single string at ~512 MB, so a large enough
// base64 leaf makes `JSON.stringify` throw `RangeError: Invalid string length`
// — an opaque 500; (2) the browser holds several full copies and OOMs the tab.
// This is a DEFENSIVE backstop only: it turns a silent crash into a clear 413
// so the failure is loud. The real fix (stream large file outputs out-of-band)
// is ADR 0003 — until that lands, this cap is the safety net. Sized well above
// any legitimate inline payload today, well below the V8 string wall.
export const COMPUTE_RESPONSE_MAX_BYTES = readPositiveInt('COMPUTE_RESPONSE_MAX_BYTES', 300 * MB);

// Hard cap + deadline on fetching remote definitions. The cap tracks
// MAX_GH_FILE_SIZE; the timeout protects against slow-loris hosts.
export const REMOTE_DEFINITION_MAX_BYTES = MAX_GH_FILE_SIZE;
export const REMOTE_DEFINITION_FETCH_TIMEOUT_MS = readPositiveInt(
	'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
	30_000
);

// In-process cache for remote-fetched .gh bytes.
export const DEFINITION_CACHE_TTL_MS = readPositiveInt('DEFINITION_CACHE_TTL_MS', 5 * 60 * 1000);

// ============================================================================
// Server definition-cache reuse (pointer instead of re-uploading the binary)
// ============================================================================
// When on, a definition is uploaded to Rhino.Compute once; later solves of the
// same definition send only the server's cache-key pointer, skipping the
// (multi-MB) base64 re-upload. On a stale-pointer miss the client
// (@selvajs/compute) transparently re-uploads.
//
// SAFETY: the transparent miss-recovery only works on a Rhino.Compute server that
// signals the miss — either the VektorNode fork's `code: "definition_not_cached"`
// or a fork that throws "Unable to load grasshopper definition". A server that
// instead returns an empty 200 on a stale pointer would silently yield EMPTY
// geometry after a compute restart / on a fresh instance. Leave this ON only when
// you control the compute server and know its miss behavior; set
// COMPUTE_REUSE_DEFINITION_CACHE=false for an unknown / standard rhino.compute.
export const COMPUTE_REUSE_DEFINITION_CACHE = readBool('COMPUTE_REUSE_DEFINITION_CACHE', true);

// ============================================================================
// Server-side solve-result cache (`cachesolve`)
// ============================================================================
// When on, Selva asks Rhino.Compute to cache solve RESULTS keyed on the full
// request (definition + inputs), and to return a cached result on an identical
// repeat — skipping the actual Grasshopper solve. Distinct from the two layers
// above: the in-process response cache (per Selva instance, 5-min TTL) and
// pointer reuse (skips re-upload, not the solve). This one is server-wide
// (memory + disk, LRU-evicted under memory pressure) so it survives Selva
// restarts and is shared across instances.
//
// Only helps IDENTICAL re-solves (same definition AND same inputs) — a changed
// slider is always a miss. Default ON: identical re-solves return instantly and
// survive Selva restarts / span instances. Set COMPUTE_SERVER_CACHESOLVE=false if
// the compute server is memory-constrained or your definitions emit large outputs
// (the cached results live in the server's memory + disk).
export const COMPUTE_SERVER_CACHESOLVE = readBool('COMPUTE_SERVER_CACHESOLVE', true);

// Opt-in: also cache solves that reported Grasshopper errors. By default the
// compute server never caches an errored solve (an error usually means a bad
// result), so a definition that errors re-solves every time. But many definitions
// throw GH errors BY DESIGN (a guarded Python component, a filtered/pruned branch)
// while still producing correct geometry — for those, caching the errored result
// is correct and a big win. Default OFF (conservative): only enable when your
// definitions' errors are known to be benign. Requires COMPUTE_SERVER_CACHESOLVE
// and a compute server that honors the flag (VektorNode fork).
export const COMPUTE_CACHE_ERRORED_SOLVES = readBool('COMPUTE_CACHE_ERRORED_SOLVES', false);
