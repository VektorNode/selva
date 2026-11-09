import type { ErrorCode } from './errors';

/** A backend's error-body `code` → one of our `ErrorCodes`. */
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
	 * (credentials, `X-Request-ID`, `Content-Type`, and `X-Session-Id` when `sessionId` is set) wins
	 * over a caller header of any casing.
	 */
	headers?: Record<string, string>;
	/**
	 * Sent as `X-Session-Id`. The VektorNode compute fork routes requests that share an id back to
	 * the child holding their warm document. Other servers ignore it, except from a browser: a
	 * custom header needs a CORS preflight, so a server that doesn't allow `X-Session-Id` fails
	 * every request with `CORS_ERROR`. 1 to 128 characters from `!` to `~`, or `INVALID_CONFIG` is
	 * thrown before any request goes out.
	 */
	sessionId?: string;
	/** Log each request at debug level through the configured logger (see `setLogger`). */
	debug?: boolean;
	/** Silence the warning logged when a call runs in a browser, where the config is exposed. */
	suppressBrowserWarning?: boolean;
	/**
	 * Per-attempt timeout, re-armed on every retry: the worst case is `(attempts + 1) × timeoutMs`
	 * plus backoff. Pass `signal` for an overall deadline. On Node it can't outlast undici's own
	 * `headersTimeout`, and neither can `0`: see {@link fetch}. Loading a `DefinitionRef` gets its
	 * own `timeoutMs`, before the first attempt.
	 */
	timeoutMs?: number;
	/**
	 * Sends requests in place of the global `fetch`. A Node host with solves past undici's default
	 * `headersTimeout` needs one, bound to a dispatcher with a longer limit.
	 */
	fetch?: typeof fetch;
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
	 * Maps the `code` field of this backend's JSON error bodies to our `ErrorCodes`. A listed
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

/** Routing outcomes the VektorNode fork reports in `Server-Timing`; the parser drops any other. */
export const AFFINITY_OUTCOMES = ['hit', 'claimed', 'spilled', 'none'] as const;
export type AffinityOutcome = (typeof AFFINITY_OUTCOMES)[number];

/**
 * The solve endpoint's `Server-Timing`, durations in ms. `raw` keeps the whole header,
 * unrecognised metrics included. Any field but `raw` can be missing: a proxy can report `affinity`
 * for a child that sends no timing at all.
 */
export interface ServerTiming {
	decode?: number;
	solve?: number;
	encode?: number;
	/** The part of `solve` spent inside Grasshopper; the rest collects the outputs. */
	gh?: number;
	/** Objects the solve ran out of all it holds. Few ran when only a downstream input changed. */
	recomputed?: { ran: number; total: number };
	/** The server answered from its result cache and solved nothing. */
	cacheHit?: boolean;
	/**
	 * How the VektorNode fork routed a request carrying `sessionId`. `hit`: ran on the child the
	 * session claims, the only outcome that finds its document warm. `spilled`: that child was busy,
	 * so it ran on another and the claim moved there. `claimed`: the session had no live claim and
	 * got one. `none`: no claim was made, because routing is off or the chosen child was gone.
	 */
	affinity?: AffinityOutcome;
	raw: string;
}
