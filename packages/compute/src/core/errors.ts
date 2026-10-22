export const ErrorCodes = {
	/** Connection failure, a gateway status (502/503/504), or a 2xx body cut off mid-stream. */
	NETWORK_ERROR: 'NETWORK_ERROR',
	/** HTTP 401 or 403: the server rejected the credentials. */
	AUTH_ERROR: 'AUTH_ERROR',
	/** The server rejected the request (HTTP 400, 413), or an input failed a client-side check. */
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	/** The server failed the solve (HTTP 500), or the solve reported errors. */
	COMPUTATION_ERROR: 'COMPUTATION_ERROR',
	/** No response within `ComputeConfig.timeoutMs`. */
	TIMEOUT_ERROR: 'TIMEOUT_ERROR',
	/** A browser fetch failed with no response: most often CORS, which the browser hides. */
	CORS_ERROR: 'CORS_ERROR',
	/** HTTP 404: the endpoint doesn't exist on this server. Never retried. */
	NOT_FOUND: 'NOT_FOUND',
	/** HTTP 429. Retried, honouring `Retry-After`, when the policy allows (`RetryPolicy.retryOn429`). */
	RATE_LIMIT: 'RATE_LIMIT',
	/** A 2xx that declared a non-JSON body, e.g. a captive portal or proxy login page. Never retried. */
	INVALID_RESPONSE: 'INVALID_RESPONSE',
	/** Any failure not classified by another code. */
	UNKNOWN_ERROR: 'UNKNOWN_ERROR',
	/** An object was used after `dispose()`, or a file download failed part-way. */
	INVALID_STATE: 'INVALID_STATE',
	/** A caller-supplied argument is unusable: an empty definition, an unserializable body. */
	INVALID_INPUT: 'INVALID_INPUT',
	/** Bad configuration: an invalid `serverUrl`, an incomplete logger, an interval out of range. */
	INVALID_CONFIG: 'INVALID_CONFIG',
	/** A browser-only API (file download) was called outside a browser. */
	BROWSER_ONLY: 'BROWSER_ONLY',
	/** The runtime has no base64 codec: neither `Buffer` nor `atob`/`btoa`. */
	ENVIRONMENT_ERROR: 'ENVIRONMENT_ERROR',
	/** A string that should be base64 isn't. */
	ENCODING_ERROR: 'ENCODING_ERROR',
	/** An input's `default` had a shape the normalizer didn't recognize. */
	MALFORMED_DEFAULT: 'MALFORMED_DEFAULT',
	/** Latest-wins scheduling: a newer call replaced this one. */
	SUPERSEDED: 'SUPERSEDED',
	/** The scheduler or a caller-supplied `AbortSignal` aborted this call. */
	ABORTED: 'ABORTED',
	/**
	 * The queue was at `maxQueueDepth`, so the call was rejected without queueing. Retryable after a
	 * back-off. `context` carries `{ queueDepth, maxQueueDepth }`.
	 */
	QUEUE_FULL: 'QUEUE_FULL',
	/**
	 * The call waited longer than `queueWaitMs` without starting, and was rejected rather than run
	 * stale. Retryable. `context` carries `{ waitedMs, queueWaitMs }`.
	 */
	QUEUE_TIMEOUT: 'QUEUE_TIMEOUT',
	/**
	 * The server no longer holds the definition a `pointer` named (evicted, restarted, another
	 * child). Retry with the full definition. Read from the error body's
	 * `code: "definition_not_cached"`.
	 */
	DEFINITION_NOT_CACHED: 'DEFINITION_NOT_CACHED'
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Error with a typed `code`: switch on it rather than on the message. */
export class ComputeError extends Error {
	public readonly code: ErrorCode;
	public readonly statusCode?: number;
	public readonly context?: Record<string, unknown>;
	public readonly originalError?: Error;

	constructor(
		message: string,
		code: ErrorCode = ErrorCodes.UNKNOWN_ERROR,
		options?: { statusCode?: number; context?: Record<string, unknown>; originalError?: Error }
	) {
		super(message);
		this.name = 'ComputeError';
		this.code = code;
		this.statusCode = options?.statusCode;
		this.context = options?.context;
		this.originalError = options?.originalError;
		if (options?.originalError) {
			(this as { cause?: unknown }).cause = options.originalError;
		}
	}

	/**
	 * Create an error for missing/empty values
	 */
	static missingValues(
		inputName: string,
		expectedType?: string,
		context?: Record<string, unknown>
	) {
		return new ComputeError(
			`Input "${inputName}" has no values defined${expectedType ? ` (expected ${expectedType})` : ''}`,
			ErrorCodes.INVALID_INPUT,
			{ context: { inputName, expectedType, ...context } }
		);
	}

	/**
	 * Create an error for unknown parameter type
	 */
	static unknownParamType(
		paramType: string,
		paramName?: string,
		context?: Record<string, unknown>
	) {
		return new ComputeError(`Unknown paramType: ${paramType}`, ErrorCodes.VALIDATION_ERROR, {
			context: { receivedParamType: paramType, paramName, ...context }
		});
	}
}
