/**
 * Single source of truth for compute-app server-side limits. Every knob below
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

function readPositiveInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.warn(`[computeLimits] Invalid ${name}=${raw}, falling back to ${fallback}`);
		return fallback;
	}
	return Math.floor(parsed);
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
export const MAX_SOLVE_DURATION_MS = readPositiveInt('MAX_SOLVE_DURATION_MS', 60_000);

// ============================================================================
// Per-key compute rate limit (see computeRateLimit.server.ts)
// ============================================================================
// Fixed-window cap on /api/compute. Default 120 / 60s = 2 solves/sec sustained,
// well above what slider scrubbing produces in practice (one-in-flight throttle
// + 150ms slider debounce ≈ 6/sec peak only when solves are <50ms; in steady
// state the cap is rarely touched). If you raise MAX_SOLVE_DURATION_MS for
// long-running definitions, the rate cap rarely needs to move with it (each
// long solve is one request, not many).
export const RATE_LIMIT_WINDOW_MS = readPositiveInt('COMPUTE_RATE_LIMIT_WINDOW_MS', 60_000);
export const RATE_LIMIT_MAX_REQUESTS = readPositiveInt('COMPUTE_RATE_LIMIT_MAX', 120);

// ============================================================================
// Upload + payload caps
// ============================================================================
// Largest .gh definition we accept on upload AND the largest remote definition
// we'll fetch for compute. Kept in lockstep deliberately — a remote URL must
// not be a way to smuggle a file past the upload cap.
export const MAX_GH_FILE_SIZE = readPositiveInt('MAX_GH_FILE_SIZE_BYTES', 50 * MB);
export const MAX_IMAGE_FILE_SIZE = readPositiveInt('MAX_IMAGE_FILE_SIZE_BYTES', 10 * MB);

// /api/compute JSON body cap. This is inputs + values, not the .gh — typical
// payloads are tens of KB. 5 MB is generous; larger is almost certainly abuse.
export const COMPUTE_REQUEST_MAX_BYTES = readPositiveInt('COMPUTE_REQUEST_MAX_BYTES', 5 * MB);

// Hard cap + deadline on fetching remote definitions. The cap tracks
// MAX_GH_FILE_SIZE; the timeout protects against slow-loris hosts.
export const REMOTE_DEFINITION_MAX_BYTES = MAX_GH_FILE_SIZE;
export const REMOTE_DEFINITION_FETCH_TIMEOUT_MS = readPositiveInt(
	'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
	30_000
);

// In-process cache for remote-fetched .gh bytes.
export const DEFINITION_CACHE_TTL_MS = readPositiveInt('DEFINITION_CACHE_TTL_MS', 5 * 60 * 1000);
