import type { ErrorCode } from './errors';

/** A backend's error-body `code` → one of our {@link ErrorCodes}. */
export type ServerErrorCodeMap = Record<string, ErrorCode>;

/**
 * Exponential backoff with jitter; a server `Retry-After` replaces the backoff for that attempt.
 *
 * Requests are POSTs: a connection lost after the body was sent may already have run on the
 * server, and the retry runs it again. A solve is deterministic, so that wastes work but corrupts
 * nothing; a non-idempotent endpoint should keep `attempts: 0`.
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
	serverUrl: string;
	/** Optional API key for authenticating with the server. Sent as {@link apiKeyHeader}. */
	apiKey?: string;
	/**
	 * Header name carrying `apiKey`. Defaults to `'RhinoComputeKey'` — the name
	 * rhino.compute expects. A different backend sets its own.
	 */
	apiKeyHeader?: string;
	/** Sent verbatim as the `Authorization` header, so include the scheme (`Bearer …`). */
	authToken?: string;
	/**
	 * Extra request headers, e.g. routing hints a reverse proxy reads. A header the transport sets
	 * (credentials, `X-Request-ID`, `Content-Type`) wins over a caller header of any casing.
	 */
	headers?: Record<string, string>;
	/** Log each request at debug level through the configured logger (see `setLogger`). */
	debug?: boolean;
	/** Silence the warning logged when a call that carries the API key runs in a browser. */
	suppressBrowserWarning?: boolean;
	/**
	 * Per-attempt timeout, re-armed on every retry: the worst case is `(attempts + 1) × timeoutMs`
	 * plus backoff. Pass `signal` for an overall deadline.
	 */
	timeoutMs?: number;
	/** Retry policy for transient errors. Default: no retries. */
	retry?: RetryPolicy;
	/**
	 * Cancels the request, including during a retry backoff. Composes with `timeoutMs`: whichever
	 * fires first wins.
	 */
	signal?: AbortSignal;
	/**
	 * Largest response body, in UTF-8 bytes, read before the download is cancelled with
	 * `RESPONSE_TOO_LARGE`. A Grasshopper solve leaves out the uploaded definition the server echoes
	 * back. Default: no limit.
	 */
	maxResponseBytes?: number;
	/**
	 * Maps the `code` field of this backend's JSON error bodies to our {@link ErrorCodes}. A listed
	 * code outranks the status-based mapping: the server's production mode scrubs the human message
	 * but not the code. Core knows no backend's codes; the client supplies its own table.
	 */
	serverErrorCodes?: ServerErrorCodeMap;
	/**
	 * Called with the server's `Server-Timing` breakdown when the response carries a recognised
	 * metric, including on a 500 partial success. `requestId` matches the `X-Request-ID` header.
	 * A throwing callback doesn't fail the request.
	 */
	onServerTiming?: (timing: ServerTiming, requestId: string) => void;
}

/** The config fields that decide how a request authenticates. */
export type ComputeAuth = Pick<ComputeConfig, 'apiKey' | 'apiKeyHeader' | 'authToken' | 'headers'>;

/** `Server-Timing` durations in ms. `raw` keeps the whole header, unrecognised metrics included. */
export interface ServerTiming {
	decode?: number;
	solve?: number;
	encode?: number;
	raw: string;
}
