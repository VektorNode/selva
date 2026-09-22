import type { ErrorCode } from './errors';

// Config

/**
 * Backend wire code (the JSON error body's `code` field) → one of our
 * {@link ErrorCodes}. An unlisted code falls back to the status-based mapping.
 */
export type ServerErrorCodeMap = Record<string, ErrorCode>;

// Retry policy: exponential backoff, respects Retry-After header (up to 60s safety cap).
// WHY: Duplicate-POST risk: network errors after send but before response may have
// already executed the request on the server. Compute is idempotent, but non-idempotent
// endpoints should set `attempts: 0`.
export interface RetryPolicy {
	/** Maximum number of retry attempts after the initial request (default: 0). */
	attempts?: number;
	/** Base delay in milliseconds for exponential backoff (default: 500). */
	baseDelayMs?: number;
	/** Upper bound for backoff delay (default: 30_000). */
	maxDelayMs?: number;
	/** Whether to retry on 429 responses (default: true, honors Retry-After). */
	retryOn429?: boolean;
}

export interface ComputeConfig {
	// WHY: must target the proxy, not bare compute.geometry child process.
	// ComputeServerStats needs proxy endpoints like / and /activechildren.
	serverUrl: string;
	/** Optional API key for authenticating with the server. Sent as {@link apiKeyHeader}. */
	apiKey?: string;
	/**
	 * Header name carrying `apiKey`. Defaults to `'RhinoComputeKey'`, the name
	 * rhino.compute expects. A different backend sets its own.
	 */
	apiKeyHeader?: string;
	/** Optional Bearer token for authentication (e.g., when behind a proxy or API gateway) */
	authToken?: string;
	// WHY: merged UNDER auth/request-id headers so they can't be overridden.
	// Use for routing hints (e.g. definition affinity) that reverse proxies read.
	headers?: Record<string, string>;
	/** Enable debug logging to the console */
	debug?: boolean;
	/** Suppress browser security warnings in the console */
	suppressBrowserWarning?: boolean;
	// WHY: per-attempt timeout (not total deadline). Re-armed on each retry, so
	// worst-case = (attempts + 1) × timeoutMs + backoff. Pass your own signal for
	// a hard overall deadline. Using AbortSignal.timeout avoids tab throttling.
	timeoutMs?: number;
	/**
	 * Retry policy for transient errors. Default: no retries.
	 */
	retry?: RetryPolicy;
	/**
	 * Optional caller-supplied AbortSignal. Composes with the internal timeout:
	 * whichever fires first wins. Lets callers cancel in-flight requests
	 * (e.g. on component unmount or when superseding a stale solve).
	 */
	signal?: AbortSignal;
	/**
	 * Machine-readable error codes this backend tags onto its error bodies, mapped
	 * to our {@link ErrorCodes}. A code here outranks the status-based mapping.
	 * Core knows no backend's codes: the client supplies its own table.
	 */
	serverErrorCodes?: ServerErrorCodeMap;
	// WHY: telemetry side-channel. Fires once per request (before return), including
	// on partial-success (HTTP 500 with real timings). Doesn't change behavior.
	// requestId matches X-Request-ID header for correlating with debug logs.
	onServerTiming?: (timing: ServerTiming, requestId: string) => void;
}

// Server-Timing metrics (ms). `raw` preserves non-standard metrics.
export interface ServerTiming {
	decode?: number;
	solve?: number;
	encode?: number;
	raw: string;
}
