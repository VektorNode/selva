import { RhinoComputeError, ErrorCodes, type ErrorCode } from '../errors';
import { getLogger } from '../utils/logger';
import { utf8ByteLength } from '../utils/encoding';

import type { ComputeConfig, RetryPolicy, ServerTiming } from '../types';

// ============================================================================
// Server-Timing
// ============================================================================

/**
 * Parse a `Server-Timing` header value into typed durations (ms).
 *
 * Header grammar (RFC 9110 §10.1.10), as emitted by the solve endpoint:
 *   `decode;dur=3, solve;dur=120, encode;dur=8`
 *
 * Returns null when the header is absent or carries no recognizable metric, so
 * the caller can skip the callback entirely.
 *
 * @internal exported for tests
 */
export function parseServerTiming(headerValue: string | null): ServerTiming | null {
	if (!headerValue) return null;
	const timing: ServerTiming = { raw: headerValue };
	let sawMetric = false;
	for (const part of headerValue.split(',')) {
		const [name, ...params] = part.trim().split(';');
		const durParam = params.find((p) => p.trim().toLowerCase().startsWith('dur'));
		if (!durParam) continue;
		const dur = Number(durParam.split('=')[1]);
		if (!Number.isFinite(dur)) continue;
		const key = name.trim().toLowerCase();
		if (key === 'decode' || key === 'solve' || key === 'encode') {
			timing[key] = dur;
			sawMetric = true;
		}
	}
	return sawMetric ? timing : null;
}

// ============================================================================
// Retry Policy
// ============================================================================

const DEFAULT_RETRY: Required<RetryPolicy> = {
	attempts: 0,
	baseDelayMs: 500,
	maxDelayMs: 30_000,
	retryOn429: true
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Absolute ceiling for a server-supplied `Retry-After` wait. The server's
 * stated window wins over `retryPolicy.maxDelayMs` (retrying earlier all but
 * guarantees another 429), but a bad/hostile header must not park the client
 * for minutes — anything above this cap is clamped.
 */
const RETRY_AFTER_CAP_MS = 60_000;

/** Upper bound for the raw server body stored on error `context.responseBody`. */
const MAX_CONTEXT_BODY_CHARS = 4096;

function resolveRetryPolicy(policy: RetryPolicy | undefined): Required<RetryPolicy> {
	if (!policy) return DEFAULT_RETRY;
	return {
		attempts: policy.attempts ?? DEFAULT_RETRY.attempts,
		baseDelayMs: policy.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
		maxDelayMs: policy.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
		retryOn429: policy.retryOn429 ?? DEFAULT_RETRY.retryOn429
	};
}

/**
 * Parse a Retry-After header value (seconds-int or HTTP-date) into ms.
 * Returns null if the header is missing or unparseable.
 */
function parseRetryAfter(headerValue: string | null): number | null {
	if (!headerValue) return null;
	const seconds = Number(headerValue);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const dateMs = Date.parse(headerValue);
	if (Number.isFinite(dateMs)) {
		const delta = dateMs - Date.now();
		return delta > 0 ? delta : 0;
	}
	return null;
}

function backoffDelay(attempt: number, policy: Required<RetryPolicy>): number {
	const exponential = policy.baseDelayMs * Math.pow(2, attempt);
	const jitter = Math.random() * policy.baseDelayMs;
	return Math.min(exponential + jitter, policy.maxDelayMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const id = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(id);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

// ============================================================================
// Error Handling
// ============================================================================

/** Truncate a server body for storage on error context — bounded, with an honest marker. */
function truncateBody(body: string): string {
	if (body.length <= MAX_CONTEXT_BODY_CHARS) return body;
	return `${body.slice(0, MAX_CONTEXT_BODY_CHARS)}… [truncated ${body.length - MAX_CONTEXT_BODY_CHARS} chars]`;
}

function throwHttpError(
	response: Response,
	fullUrl: string,
	requestId: string,
	requestSize: number,
	serverUrl: string,
	errorBody: string,
	serverCode?: string,
	rawBody?: string
): never {
	const { status, statusText } = response;

	const responseHeaders: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		responseHeaders[key] = value;
	});

	const trimmed = errorBody.trim();
	const bodyHint = trimmed ? ` — ${trimmed.slice(0, 200)}${trimmed.length > 200 ? '…' : ''}` : '';

	// context.responseBody holds the RAW server body (what actually came over the
	// wire), bounded to MAX_CONTEXT_BODY_CHARS so a huge body isn't pinned for the
	// error's lifetime. `errorBody` may have been rewritten into a synthesized
	// message (500 exception shape) — that goes in the message, not the context.
	const storedBody = rawBody ?? errorBody;
	const context = {
		url: fullUrl,
		requestId,
		method: 'POST',
		requestSize,
		serverUrl,
		responseBody: storedBody ? truncateBody(storedBody) : undefined,
		responseHeaders
	};

	const errorMap: Record<number, { message: string; code: ErrorCode }> = {
		401: { message: `HTTP ${status}: ${statusText}${bodyHint}`, code: ErrorCodes.AUTH_ERROR },
		403: { message: `HTTP ${status}: ${statusText}${bodyHint}`, code: ErrorCodes.AUTH_ERROR },
		404: { message: `Endpoint not found: ${fullUrl}`, code: ErrorCodes.NOT_FOUND },
		413: {
			message: `Request too large: ${(requestSize / 1024).toFixed(2)}KB`,
			code: ErrorCodes.VALIDATION_ERROR
		},
		429: { message: `Rate limit exceeded${bodyHint}`, code: ErrorCodes.RATE_LIMIT },
		500: { message: `Server error: ${statusText}${bodyHint}`, code: ErrorCodes.COMPUTATION_ERROR },
		502: {
			message: `Service unavailable: ${statusText}${bodyHint}`,
			code: ErrorCodes.NETWORK_ERROR
		},
		503: {
			message: `Service unavailable: ${statusText}${bodyHint}`,
			code: ErrorCodes.NETWORK_ERROR
		},
		504: {
			message: `Service unavailable: ${statusText}${bodyHint}`,
			code: ErrorCodes.NETWORK_ERROR
		}
	};

	const error = errorMap[status] || {
		message: `HTTP ${status}: ${statusText}${bodyHint}`,
		code: ErrorCodes.UNKNOWN_ERROR
	};

	// A machine code in the server's error body (e.g. "definition_not_cached")
	// outranks the status-based mapping: it's stable across the server's
	// production message-scrubbing, where the human message is replaced with a
	// generic string. Keep the status-derived message for context.
	const code = mapServerErrorCode(serverCode) ?? error.code;

	throw new RhinoComputeError(error.message, code, { statusCode: status, context });
}

/**
 * Map a server-supplied error code (from the JSON error body's `code` field) to
 * one of our {@link ErrorCodes}. Returns `undefined` for an absent or unknown
 * code so the caller falls back to its status-based mapping.
 */
function mapServerErrorCode(serverCode?: string): ErrorCode | undefined {
	switch (serverCode) {
		case 'definition_not_cached':
			return ErrorCodes.DEFINITION_NOT_CACHED;
		default:
			return undefined;
	}
}

// ============================================================================
// Request Helpers
// ============================================================================

function buildUrl(endpoint: string, serverUrl: string): string {
	const base = serverUrl.replace(/\/+$/, '');
	const path = endpoint.replace(/^\/+/, '');
	return `${base}/${path}`;
}

function isLocalhost(serverUrl: string): boolean {
	try {
		// `hostname` (not `host`) strips the port; IPv6 hostnames keep their
		// brackets, so `http://[::1]:6500` yields `[::1]`.
		const hostname = new URL(serverUrl).hostname.toLowerCase();
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
	} catch {
		return /(localhost|127\.0\.0\.1|\[::1\])/i.test(serverUrl);
	}
}

/** Server URLs already warned about missing auth — warn once per server, not per request. */
const warnedNoAuth = new Set<string>();

function buildHeaders(requestId: string, config: ComputeConfig): HeadersInit {
	const headers: HeadersInit = {
		// Caller headers first so the transport's own headers below OVERWRITE them —
		// a caller can never clobber the request id, content type, or auth.
		...config.headers,
		'X-Request-ID': requestId,
		'Content-Type': 'application/json',
		...(config.authToken && { Authorization: config.authToken }),
		...(config.apiKey && { RhinoComputeKey: config.apiKey })
	};

	if (
		!config.apiKey &&
		!config.authToken &&
		!warnedNoAuth.has(config.serverUrl) &&
		!isLocalhost(config.serverUrl)
	) {
		warnedNoAuth.add(config.serverUrl);
		getLogger().warn(
			`⚠️ [Rhino Compute] Request [${requestId}] targets remote server (${config.serverUrl}) but no API key or auth token is configured. Requests may fail or be rate-limited. (warned once per server)`
		);
	}

	return headers;
}

function generateRequestId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function log(message: string, debug?: boolean): void {
	if (debug) getLogger().debug(message);
}

/**
 * Compose a caller-supplied AbortSignal with an optional timeout. Returns a
 * combined signal, or `undefined` if neither was given.
 *
 * Uses `AbortSignal.timeout` (not setTimeout) so the timer is not throttled
 * when the tab is hidden. Falls back to a manual timer for older runtimes.
 *
 * @internal exported for tests
 */
export function composeSignal(
	callerSignal: AbortSignal | undefined,
	timeoutMs: number | undefined
): { signal: AbortSignal | undefined; cleanup: () => void } {
	const noCleanup = () => {};
	const wantsTimeout = typeof timeoutMs === 'number' && timeoutMs > 0;

	if (!callerSignal && !wantsTimeout) return { signal: undefined, cleanup: noCleanup };
	if (callerSignal && !wantsTimeout) return { signal: callerSignal, cleanup: noCleanup };

	const supportsTimeout =
		typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';

	// Timeout only: nothing is registered on a caller signal, so there is nothing to clean up on
	// the modern path (the pending timer is small and self-expires at timeoutMs).
	if (!callerSignal) {
		if (supportsTimeout) return { signal: AbortSignal.timeout(timeoutMs!), cleanup: noCleanup };
		const ctrl = new AbortController();
		const id = setTimeout(() => ctrl.abort(), timeoutMs);
		return { signal: ctrl.signal, cleanup: () => clearTimeout(id) };
	}

	// Caller signal + timeout: composed manually rather than with AbortSignal.any — `any` offers no
	// way to unregister its dependent link on the caller's signal, so an app reusing one long-lived
	// signal across many solves accumulates a registration per attempt for the full timeoutMs after
	// each response (and forever on Node versions with the known AbortSignal.any leak).
	const ctrl = new AbortController();

	let timeoutSignal: AbortSignal;
	let timerId: ReturnType<typeof setTimeout> | undefined;
	if (supportsTimeout) {
		timeoutSignal = AbortSignal.timeout(timeoutMs!);
	} else {
		const timeoutCtrl = new AbortController();
		timerId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
		timeoutSignal = timeoutCtrl.signal;
	}

	const sources = [callerSignal, timeoutSignal];
	// Forward the source's reason so fetch rejects with the right error name
	// ('TimeoutError' vs 'AbortError'), matching AbortSignal.any semantics.
	const onAbort = function (this: AbortSignal) {
		ctrl.abort(this.reason);
	};

	for (const s of sources) {
		if (s.aborted) {
			ctrl.abort(s.reason);
			break;
		}
		s.addEventListener('abort', onAbort, { once: true });
	}

	return {
		signal: ctrl.signal,
		cleanup: () => {
			if (timerId !== undefined) clearTimeout(timerId);
			for (const s of sources) s.removeEventListener('abort', onAbort);
		}
	};
}

// ============================================================================
// Response Processing
// ============================================================================

/**
 * Surface the server's per-request timing breakdown (if it sent one and a
 * caller is listening). Best-effort: a throwing callback must not fail the
 * request. Called on the success path AND the 500-with-values partial-success
 * path — solves that completed with Grasshopper errors carry real timings too.
 */
function fireServerTiming(
	response: Response,
	onServerTiming: ((timing: ServerTiming) => void) | undefined,
	debug?: boolean
): void {
	if (!onServerTiming) return;
	const timing = parseServerTiming(response.headers.get('Server-Timing'));
	if (!timing) return;
	try {
		onServerTiming(timing);
	} catch (err) {
		if (debug) log(`   onServerTiming callback threw: ${err}`, true);
	}
}

async function handleResponse(
	response: Response,
	fullUrl: string,
	requestId: string,
	requestSize: number,
	serverUrl: string,
	startTime: number,
	debug?: boolean,
	onServerTiming?: (timing: ServerTiming) => void
): Promise<any> {
	const responseTime = Math.round(performance.now() - startTime);

	if (!response.ok) {
		// Read body once and reuse. `rawBody` stays what came over the wire (stored
		// on error context); `errorBody` may be rewritten into a friendlier message.
		const rawBody = await response.text();
		let errorBody = rawBody;

		// Enhanced logging for errors
		if (debug) {
			log(
				`❌ Request [${requestId}] failed with HTTP ${response.status} in ${responseTime}ms`,
				true
			);
			log(`   URL: ${fullUrl}`, true);
			log(`   Status: ${response.status} ${response.statusText}`, true);
			if (errorBody) {
				log(
					`   Response body: ${errorBody.substring(0, 500)}${errorBody.length > 500 ? '...' : ''}`,
					true
				);
			}
		}

		// A machine-readable code the server may tag onto its error body (e.g.
		// "definition_not_cached"). Unlike the human `message`, it isn't scrubbed in
		// the server's production (non-debug) mode, so it's the reliable signal for
		// classifying the error (see throwHttpError → mapServerErrorCode). It can
		// ride any error status, not just 500, so read it here.
		let serverCode: string | undefined;

		try {
			const parsedForCode = JSON.parse(errorBody);
			if (typeof parsedForCode?.code === 'string') serverCode = parsedForCode.code;
		} catch {
			// Non-JSON body — nothing to extract.
		}

		// Check if it's a valid compute response with errors/warnings
		if (response.status === 500) {
			try {
				const parsed = JSON.parse(errorBody);
				// If it has values, it's a partial success with errors
				if (parsed?.values && (parsed.errors || parsed.warnings)) {
					if (debug) {
						log(
							`⚠️ Request [${requestId}] completed with Grasshopper errors in ${responseTime}ms`,
							true
						);
						if (parsed.errors?.length > 0) {
							log(`   Errors: ${JSON.stringify(parsed.errors, null, 2)}`, true);
						}
						if (parsed.warnings?.length > 0) {
							log(`   Warnings: ${JSON.stringify(parsed.warnings, null, 2)}`, true);
						}
					}
					fireServerTiming(response, onServerTiming, debug);
					return parsed;
				}

				// Raw server-side exception. The Compute8 server's exception handler
				// (compute.geometry Startup.cs) emits:
				//   { error: "Internal Server Error", message: "<category>: <detail>",
				//     stackTrace?: string[] }   // stackTrace only when Config.Debug
				// The actionable part is `message` — surface it, with the optional
				// stack appended for debugging. We prefer `message`/`error` (current
				// server) and keep `Message`/`ExceptionType`/`StackTrace` (old
				// PascalCase .NET shape) as a back-compat fallback so an older server
				// still produces a useful message.
				const serverMessage =
					(typeof parsed?.message === 'string' && parsed.message) ||
					(typeof parsed?.Message === 'string' && parsed.Message) ||
					'';
				const exceptionType =
					(typeof parsed?.ExceptionType === 'string' && parsed.ExceptionType) || '';
				const stack = parsed?.stackTrace ?? parsed?.StackTrace;
				const stackStr = Array.isArray(stack) ? stack.join('\n') : stack || '';

				if (serverMessage) {
					// Don't repeat the generic "Internal Server Error" label when the
					// message already carries the real detail.
					const prefix = exceptionType ? `${exceptionType}: ` : '';
					errorBody = `${prefix}${serverMessage}${stackStr ? `\n${stackStr}` : ''}`;
				} else if (parsed?.error) {
					errorBody =
						typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error, null, 2);
				}
			} catch (e) {
				if (debug) {
					log(`   Failed to parse error body as JSON: ${e}`, true);
				}
				// Not valid JSON, proceed with HTTP error
			}
		}

		throwHttpError(
			response,
			fullUrl,
			requestId,
			requestSize,
			serverUrl,
			errorBody,
			serverCode,
			rawBody
		);
	}

	log(`✅ Request [${requestId}] completed in ${responseTime}ms`, debug);

	fireServerTiming(response, onServerTiming, debug);

	try {
		return await response.json();
	} catch (error) {
		// Classify by the declared Content-Type (issue 87). A 2xx that DECLARES a
		// non-JSON body (HTML from a captive portal, a reverse-proxy login page, a
		// misconfigured endpoint) is deterministic — refetching returns the same
		// page — so fail immediately with INVALID_RESPONSE (never retried). A body
		// that fails to parse under a JSON (or absent) Content-Type means the
		// stream was likely cut mid-body — as transient as any network error — and
		// keeps the retryable NETWORK_ERROR classification.
		const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase();
		const declaredNonJson = contentType !== '' && !contentType.includes('json');
		if (declaredNonJson) {
			throw new RhinoComputeError(
				`Server returned a non-JSON response (Content-Type: ${contentType}) — check the server URL / proxy configuration`,
				ErrorCodes.INVALID_RESPONSE,
				{
					statusCode: response.status,
					context: { url: fullUrl, requestId, contentType },
					originalError: error instanceof Error ? error : new Error(String(error))
				}
			);
		}
		throw new RhinoComputeError('Failed to parse JSON response', ErrorCodes.NETWORK_ERROR, {
			statusCode: response.status,
			context: {
				url: fullUrl,
				requestId
			},
			originalError: error instanceof Error ? error : new Error(String(error))
		});
	}
}

// ============================================================================
// Single attempt
// ============================================================================

interface AttemptContext {
	endpoint: string;
	body: string;
	requestSize: number;
	fullUrl: string;
	requestId: string;
	headers: HeadersInit;
	config: ComputeConfig;
}

interface AttemptResult {
	ok: true;
	value: any;
}

interface AttemptRetry {
	ok: false;
	retry: true;
	delayMs: number;
	cause: RhinoComputeError;
}

interface AttemptFatal {
	ok: false;
	retry: false;
	cause: RhinoComputeError;
}

async function attemptFetch(
	ctx: AttemptContext,
	retryPolicy: Required<RetryPolicy>,
	attempt: number,
	totalAttempts: number
): Promise<AttemptResult | AttemptRetry | AttemptFatal> {
	const { signal, cleanup } = composeSignal(ctx.config.signal, ctx.config.timeoutMs);
	const startTime = performance.now();

	try {
		const response = await fetch(ctx.fullUrl, {
			method: 'POST',
			body: ctx.body,
			headers: ctx.headers,
			signal
		});

		// 429 with Retry-After or retryable 5xx → maybe retry
		const isRetryableStatus =
			RETRYABLE_STATUS.has(response.status) || (retryPolicy.retryOn429 && response.status === 429);

		if (isRetryableStatus && attempt < totalAttempts - 1) {
			const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
			// The server's stated Retry-After window wins over maxDelayMs — retrying
			// before it all but guarantees another 429 and burns an attempt. It is
			// only clamped by the absolute RETRY_AFTER_CAP_MS safety cap (or by a
			// caller-configured maxDelayMs that is even larger), so a bad header
			// can't force a pathological sleep. backoffDelay already clamps itself.
			const delayMs =
				retryAfterMs !== null
					? Math.min(retryAfterMs, Math.max(retryPolicy.maxDelayMs, RETRY_AFTER_CAP_MS))
					: backoffDelay(attempt, retryPolicy);
			// Drain the body so the connection can be reused on the next attempt.
			// On the *final* attempt we deliberately fall through — handleResponse
			// reads the body itself to surface the error context.
			await response.text().catch(() => {});
			return {
				ok: false,
				retry: true,
				delayMs,
				cause: new RhinoComputeError(
					`HTTP ${response.status} ${response.statusText} (will retry)`,
					response.status === 429 ? ErrorCodes.RATE_LIMIT : ErrorCodes.NETWORK_ERROR,
					{ statusCode: response.status, context: { requestId: ctx.requestId } }
				)
			};
		}

		const value = await handleResponse(
			response,
			ctx.fullUrl,
			ctx.requestId,
			ctx.requestSize,
			ctx.config.serverUrl,
			startTime,
			ctx.config.debug,
			ctx.config.onServerTiming
		);
		return { ok: true, value };
	} catch (error) {
		// Caller-aborted vs timeout-aborted distinction
		if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
			const callerAborted = ctx.config.signal?.aborted === true;

			if (callerAborted) {
				// Caller cancellation is never retried — propagate immediately
				return {
					ok: false,
					retry: false,
					cause: new RhinoComputeError('Request aborted by caller', ErrorCodes.ABORTED, {
						context: {
							endpoint: ctx.endpoint,
							requestId: ctx.requestId,
							requestSize: ctx.requestSize
						},
						originalError: error
					})
				};
			}

			// Only claim a timeout when we actually armed one (issue 88). Without a
			// configured timeoutMs, a non-caller abort came from the runtime itself
			// (e.g. an undici socket teardown) — as transient as any network drop, so
			// it stays retryable, but it is NOT a timeout: report it truthfully
			// instead of "timed out after undefinedms" / TIMEOUT_ERROR.
			const timeoutArmed = typeof ctx.config.timeoutMs === 'number' && ctx.config.timeoutMs > 0;
			const fatal = timeoutArmed
				? new RhinoComputeError(
						`Request timed out after ${ctx.config.timeoutMs}ms`,
						ErrorCodes.TIMEOUT_ERROR,
						{
							context: {
								serverUrl: ctx.config.serverUrl,
								timeoutMs: ctx.config.timeoutMs,
								url: ctx.fullUrl,
								requestId: ctx.requestId,
								endpoint: ctx.endpoint,
								requestSize: ctx.requestSize
							},
							originalError: error
						}
					)
				: new RhinoComputeError(
						`Request aborted by the runtime (${error.name}): ${error.message}`,
						ErrorCodes.NETWORK_ERROR,
						{
							context: {
								serverUrl: ctx.config.serverUrl,
								url: ctx.fullUrl,
								requestId: ctx.requestId,
								endpoint: ctx.endpoint,
								requestSize: ctx.requestSize
							},
							originalError: error
						}
					);
			if (attempt < totalAttempts - 1) {
				return {
					ok: false,
					retry: true,
					delayMs: backoffDelay(attempt, retryPolicy),
					cause: fatal
				};
			}
			return { ok: false, retry: false, cause: fatal };
		}

		// Network error (TypeError) — retryable (issue 90).
		//
		// Duplicate-POST caveat: a connection reset can strike after the body was
		// sent, in which case the server may already have executed this POST and a
		// retry runs it again. Compute solves are deterministic, so a duplicate is
		// wasted work rather than corruption; RetryPolicy documents the risk and
		// defaults to attempts: 0.
		//
		// In a real browser, a fetch TypeError with no response is most often a
		// CORS misconfiguration (the browser hides the details by design), so it is
		// classified CORS_ERROR there to stop callers chasing phantom network
		// failures. Retries are kept in both environments: the same TypeError is
		// also what a flaky/offline network produces, and there is no way to tell
		// them apart.
		if (error instanceof TypeError) {
			const inBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
			const errorContext = {
				serverUrl: ctx.config.serverUrl,
				url: ctx.fullUrl,
				requestId: ctx.requestId,
				endpoint: ctx.endpoint,
				requestSize: ctx.requestSize
			};
			const fatal = inBrowser
				? new RhinoComputeError(
						`Request failed: ${error.message} — in a browser this usually means a CORS misconfiguration on the server (or a network failure; the browser does not distinguish them)`,
						ErrorCodes.CORS_ERROR,
						{ context: errorContext, originalError: error }
					)
				: new RhinoComputeError(`Network error: ${error.message}`, ErrorCodes.NETWORK_ERROR, {
						context: errorContext,
						originalError: error
					});
			if (attempt < totalAttempts - 1) {
				return {
					ok: false,
					retry: true,
					delayMs: backoffDelay(attempt, retryPolicy),
					cause: fatal
				};
			}
			return { ok: false, retry: false, cause: fatal };
		}
		// RhinoComputeError thrown from handleResponse — already has full context.
		// Retryable only if it carries a retryable status code.
		if (error instanceof RhinoComputeError) {
			const status = error.statusCode;
			// A 2xx whose body failed to parse UNDER A JSON CONTENT-TYPE
			// (NETWORK_ERROR from handleResponse) means the stream was cut mid-body —
			// as transient as any network error. A 2xx that declared a non-JSON body
			// arrives here as INVALID_RESPONSE (deterministic — captive portal /
			// login page) and deliberately does NOT match: it is never retried.
			const isTruncatedSuccess =
				error.code === ErrorCodes.NETWORK_ERROR &&
				status !== undefined &&
				status >= 200 &&
				status < 300;
			const retryable =
				isTruncatedSuccess ||
				(status !== undefined &&
					(RETRYABLE_STATUS.has(status) || (retryPolicy.retryOn429 && status === 429)));
			if (retryable && attempt < totalAttempts - 1) {
				return {
					ok: false,
					retry: true,
					delayMs: backoffDelay(attempt, retryPolicy),
					cause: error
				};
			}
			return { ok: false, retry: false, cause: error };
		}

		// Unknown — wrap and don't retry
		return {
			ok: false,
			retry: false,
			cause: new RhinoComputeError(
				error instanceof Error ? error.message : String(error),
				ErrorCodes.UNKNOWN_ERROR,
				{
					context: { endpoint: ctx.endpoint, requestId: ctx.requestId },
					originalError: error instanceof Error ? error : new Error(String(error))
				}
			)
		};
	} finally {
		cleanup();
	}
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generic Rhino Compute fetch function.
 * Sends a POST request to any Compute endpoint with pre-prepared arguments.
 *
 * Use this for advanced, low-level control over compute requests. For most use cases, prefer higher-level APIs.
 *
 * The transport is response-type-agnostic: it does not know which response a
 * given endpoint returns. Callers supply the response type via `R` (defaulting
 * to `unknown`, which forces an explicit narrowing before use).
 *
 * Timeout semantics: `config.timeoutMs` is a PER-ATTEMPT timeout, re-armed for
 * every retry. With `retry: { attempts: N }` the worst-case wall clock is
 * `(N + 1) × timeoutMs` plus backoff sleeps (and a server `Retry-After` can
 * stretch a single sleep up to 60s). For a hard overall deadline, pass
 * `config.signal` (e.g. `AbortSignal.timeout(totalMs)`) — a caller abort wins
 * immediately, including during backoff.
 *
 * Retry caveats: requests are POSTs, so a retry after a mid-flight connection
 * loss may re-execute a request the server already ran (see {@link RetryPolicy}).
 * A 2xx response that declares a non-JSON `Content-Type` (captive portal,
 * proxy login page) fails immediately with `INVALID_RESPONSE` and is never
 * retried; a body that fails to parse under a JSON content-type is treated as
 * a truncated stream and is retried.
 *
 * @typeParam R - The expected response shape. The caller names it at the call site.
 * @param endpoint - The Compute API endpoint (e.g., 'grasshopper', 'io', 'mesh').
 * @param args - Pre-prepared arguments for the request body.
 * @param config - Compute configuration (server URL, API key, timeout, debug, retry, signal).
 * @returns The parsed JSON response from the server, typed as `R`.
 *
 * @example
 * // Basic usage for the Grasshopper endpoint:
 * const response = await fetchRhinoCompute(
 *   'grasshopper',
 *   { ... },
 *   {
 *     serverUrl: 'https://my-server.com',
 *     debug: true,
 *     timeoutMs: 30_000,
 *     retry: { attempts: 2 },
 *     signal: controller.signal,
 *   }
 * );
 */
export async function fetchRhinoCompute<R = unknown>(
	endpoint: string,
	args: Record<string, any>,
	config: ComputeConfig
): Promise<R> {
	const requestId = generateRequestId();
	const body = JSON.stringify(args);
	// Wire size in UTF-8 bytes — `body.length` counts UTF-16 code units and
	// undercounts non-ASCII payloads (matters for the 413 message and size logs).
	const requestSize = utf8ByteLength(body);
	const fullUrl = buildUrl(endpoint, config.serverUrl);
	const headers = buildHeaders(requestId, config);
	const retryPolicy = resolveRetryPolicy(config.retry);
	const totalAttempts = retryPolicy.attempts + 1;

	if (config.debug) {
		const sizeKb = (requestSize / 1024).toFixed(2);
		const emoji = requestSize > 100000 ? '⚠️' : '🚀';
		log(`${emoji} Starting compute request [${requestId}]: ${endpoint} (${sizeKb}KB)`, true);
	}

	const ctx: AttemptContext = {
		endpoint,
		body,
		requestSize,
		fullUrl,
		requestId,
		headers,
		config
	};

	// Every iteration ends in `return` or `throw` (issue 105): attemptFetch never
	// asks to retry on the final attempt (all its retry branches are gated on
	// `attempt < totalAttempts - 1`), so the exhausted-retries error is the final
	// attempt's own `result.cause` — there is no post-loop fallback to reach.
	for (let attempt = 0; ; attempt++) {
		const result = await attemptFetch(ctx, retryPolicy, attempt, totalAttempts);

		if (result.ok) return result.value as R;

		if (!result.retry) throw result.cause;

		if (config.debug) {
			log(
				`🔁 Request [${requestId}] retrying after ${result.delayMs}ms (attempt ${attempt + 2}/${totalAttempts}): ${result.cause.message}`,
				true
			);
		}

		try {
			await sleep(result.delayMs, config.signal);
		} catch {
			// Caller cancelled during backoff
			throw new RhinoComputeError('Request aborted by caller', ErrorCodes.ABORTED, {
				context: { endpoint, requestId, requestSize },
				originalError: result.cause
			});
		}
	}
}
