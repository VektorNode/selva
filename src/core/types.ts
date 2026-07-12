/**
 * Rhino model unit types supported by Rhino.Compute
 */
export type RhinoModelUnit =
	| 'None'
	| 'Microns'
	| 'Millimeters'
	| 'Centimeters'
	| 'Meters'
	| 'Kilometers'
	| 'Microinches'
	| 'Mils'
	| 'Inches'
	| 'Feet'
	| 'Miles'
	| 'CustomUnits'
	| 'Angstroms'
	| 'Nanometers'
	| 'Decimeters'
	| 'Dekameters'
	| 'Hectometers'
	| 'Megameters'
	| 'Gigameters'
	| 'Yards'
	| 'PrinterPoints'
	| 'PrinterPicas'
	| 'NauticalMiles'
	| 'AstronomicalUnits'
	| 'LightYears'
	| 'Parsecs'
	| 'Unset';

// ============================================================================
// Config
// ============================================================================

/**
 * Retry policy for transient errors (network, 502, 503, 504, optionally 429).
 *
 * Retries use exponential backoff with jitter, capped at `maxDelayMs`.
 * If the server returns `Retry-After`, that value is honored instead — even
 * above `maxDelayMs` (the server's stated window wins), up to an absolute
 * 60s safety cap.
 *
 * Duplicate-POST caveat: every compute request is a POST. A network error can
 * strike after the body was sent but before the response arrived — in that
 * window the server may already have executed the request, and a retry runs it
 * again. Compute solves are deterministic/idempotent so this is normally just
 * wasted work, but callers wrapping non-idempotent endpoints should keep
 * `attempts` at 0 (the default).
 */
export interface RetryPolicy {
	/** Maximum number of retry attempts after the initial request (default: 0). */
	attempts?: number;
	/** Base delay in milliseconds for exponential backoff (default: 500). */
	baseDelayMs?: number;
	/** Upper bound for backoff delay (default: 30_000). */
	maxDelayMs?: number;
	/** Whether to retry on 429 responses (default: true — honors Retry-After). */
	retryOn429?: boolean;
}

export interface ComputeConfig {
	/**
	 * The base URL of the Rhino Compute server (e.g., http://localhost:6500).
	 *
	 * This should point at the `rhino.compute` front (the reverse proxy), not a
	 * bare `compute.geometry` child process. `ComputeServerStats` relies on the
	 * proxy liveness root `/` and proxy-only endpoints like `/activechildren`,
	 * `/idlespan`, and the child-lifecycle controls; targeting a bare
	 * `compute.geometry` would make those 404 even though `/grasshopper` would
	 * still solve.
	 */
	serverUrl: string;
	/** Optional API key for authenticating with the server (RhinoComputeKey) */
	apiKey?: string;
	/** Optional Bearer token for authentication (e.g., when behind a proxy or API gateway) */
	authToken?: string;
	/**
	 * Extra headers sent on every solve / IO request to the compute server.
	 *
	 * Merged UNDER the transport's own headers (`X-Request-ID`, `Content-Type`,
	 * `Authorization`, `RhinoComputeKey`) so a caller can never accidentally
	 * override auth or the request id. Intended for routing/telemetry hints a
	 * reverse proxy or load balancer reads — e.g. a definition-affinity key so a
	 * pool routes repeat solves of one definition to the same VM (its per-VM
	 * definition/solve caches then hit). A single-node server ignores unknown
	 * headers, so this is inert until a router exists.
	 */
	headers?: Record<string, string>;
	/** Enable debug logging to the console */
	debug?: boolean;
	/** Suppress browser security warnings in the console */
	suppressBrowserWarning?: boolean;
	/** @deprecated Renamed to `suppressBrowserWarning`. */
	suppressClientSideWarning?: boolean;
	/**
	 * Per-**attempt** timeout in milliseconds. Set to `0` to disable (useful for
	 * long solves where any timeout is the wrong answer). Default: no timeout.
	 *
	 * This is NOT a total deadline: the timeout is re-armed for every retry
	 * attempt, so with `retry: { attempts: N }` the worst-case wall clock is
	 * `(N + 1) × timeoutMs` plus backoff sleeps between attempts. Callers that
	 * need a hard overall deadline should pass their own `signal` (e.g. from
	 * `AbortSignal.timeout(totalMs)`), which wins over any pending retry.
	 *
	 * Uses `AbortSignal.timeout` so the timer is not throttled when the tab is hidden.
	 */
	timeoutMs?: number;
	/**
	 * Retry policy for transient errors. Default: no retries.
	 */
	retry?: RetryPolicy;
	/**
	 * Optional caller-supplied AbortSignal. Composes with the internal timeout —
	 * whichever fires first wins. Lets callers cancel in-flight requests
	 * (e.g. on component unmount or when superseding a stale solve).
	 */
	signal?: AbortSignal;
	/**
	 * Optional callback invoked with the server's per-request `Server-Timing`
	 * breakdown when the response carries one (the `/grasshopper` solve endpoint
	 * emits `decode;dur=N, solve;dur=N, encode;dur=N` on every response).
	 *
	 * Fires once per request, before the parsed body is returned — on success
	 * and on the HTTP-500 partial-success path (a solve that completed with
	 * Grasshopper errors still carries real timings, often the slowest ones).
	 * The transport stays response-type-agnostic — this is a side
	 * channel for telemetry, it does not change what a call returns. Use it to
	 * feed a perf monitor or surface "solve took Nms" without server log access.
	 */
	onServerTiming?: (timing: ServerTiming) => void;
}

/**
 * Parsed `Server-Timing` metrics from a Compute response. Durations are in
 * milliseconds. Any metric the server omits is `undefined`. `raw` is the
 * original header value, preserved so callers can read non-standard metrics.
 */
export interface ServerTiming {
	/** Time the server spent decoding the request (deserialize + load definition). */
	decode?: number;
	/** Time spent actually solving the Grasshopper definition. */
	solve?: number;
	/** Time spent encoding the response (serialize geometry). */
	encode?: number;
	/** The raw `Server-Timing` header value, e.g. `decode;dur=3, solve;dur=120, encode;dur=8`. */
	raw: string;
}
