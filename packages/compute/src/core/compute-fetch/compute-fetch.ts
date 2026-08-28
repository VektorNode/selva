import { ComputeError, ErrorCodes } from '../errors';
import { utf8ByteLength } from '../utils/encoding';
import { log } from './log';
import { buildUrl, buildHeaders, generateRequestId } from './request';
import { handleResponse } from './response';
import {
	RETRYABLE_STATUS,
	RETRY_AFTER_CAP_MS,
	backoffDelay,
	parseRetryAfter,
	resolveRetryPolicy,
	sleep
} from './retry';
import { composeSignal } from './signal';

import type { ComputeConfig, RetryPolicy } from '../types';

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
	cause: ComputeError;
}

interface AttemptFatal {
	ok: false;
	retry: false;
	cause: ComputeError;
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
				cause: new ComputeError(
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
			ctx.config.onServerTiming,
			ctx.config.serverErrorCodes
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
					cause: new ComputeError('Request aborted by caller', ErrorCodes.ABORTED, {
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
				? new ComputeError(
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
				: new ComputeError(
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
				? new ComputeError(
						`Request failed: ${error.message} — in a browser this usually means a CORS misconfiguration on the server (or a network failure; the browser does not distinguish them)`,
						ErrorCodes.CORS_ERROR,
						{ context: errorContext, originalError: error }
					)
				: new ComputeError(`Network error: ${error.message}`, ErrorCodes.NETWORK_ERROR, {
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
		// ComputeError thrown from handleResponse — already has full context.
		// Retryable only if it carries a retryable status code.
		if (error instanceof ComputeError) {
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
			cause: new ComputeError(
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
 * const response = await fetchCompute(
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
export async function fetchCompute<R = unknown>(
	endpoint: string,
	args: Record<string, any>,
	config: ComputeConfig
): Promise<R> {
	const requestId = generateRequestId();
	// A circular or BigInt-containing payload makes JSON.stringify throw a raw
	// TypeError; surface it as the INVALID_INPUT ComputeError this function's
	// contract promises, before anything touches the network.
	let body: string;
	try {
		body = JSON.stringify(args);
	} catch (error) {
		throw new ComputeError(
			`Request body is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
			ErrorCodes.INVALID_INPUT,
			{
				context: { endpoint, requestId },
				originalError: error instanceof Error ? error : new Error(String(error))
			}
		);
	}
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
			throw new ComputeError('Request aborted by caller', ErrorCodes.ABORTED, {
				context: { endpoint, requestId, requestSize },
				originalError: result.cause
			});
		}
	}
}
