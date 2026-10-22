import { ComputeError, ErrorCodes } from '../errors';
import { utf8ByteLength } from '../utils/encoding';
import { getLogger } from '../utils/logger';
import { buildUrl, buildHeaders, generateRequestId } from './request';
import { handleResponse, type RequestContext } from './response';
import { backoffDelay, isRetryableStatus, resolveRetryPolicy, retryDelay, sleep } from './retry';
import { composeSignal, isAbortError } from './signal';

import type { ComputeConfig, RetryPolicy } from '../types';

interface AttemptContext extends RequestContext {
	endpoint: string;
	body: string;
	headers: HeadersInit;
	errorContext: Record<string, unknown>;
}

type AttemptOutcome =
	| { ok: true; value: unknown }
	| { ok: false; cause: ComputeError; retryable: boolean; delayMs?: number };

function abortedByCaller(ctx: AttemptContext, originalError: Error): ComputeError {
	return new ComputeError('Request aborted by caller', ErrorCodes.ABORTED, {
		context: ctx.errorContext,
		originalError
	});
}

async function attemptFetch(
	ctx: AttemptContext,
	policy: Required<RetryPolicy>,
	attempt: number,
	isFinal: boolean
): Promise<AttemptOutcome> {
	const { signal, cleanup } = composeSignal(ctx.config.signal, ctx.config.timeoutMs);
	const startTime = performance.now();

	try {
		const response = await fetch(ctx.fullUrl, {
			method: 'POST',
			body: ctx.body,
			headers: ctx.headers,
			signal
		});

		if (!isFinal && isRetryableStatus(response.status, policy)) {
			// Drain so the connection can be reused. The final attempt skips this branch so
			// handleResponse reads the body into the error instead.
			await response.text().catch(() => {});
			return {
				ok: false,
				retryable: true,
				delayMs: retryDelay(response.headers.get('Retry-After'), attempt, policy),
				cause: new ComputeError(
					`HTTP ${response.status} ${response.statusText} (will retry)`,
					response.status === 429 ? ErrorCodes.RATE_LIMIT : ErrorCodes.NETWORK_ERROR,
					{ statusCode: response.status, context: ctx.errorContext }
				)
			};
		}

		return { ok: true, value: await handleResponse(response, ctx, startTime) };
	} catch (error) {
		return classifyFetchError(error, ctx);
	} finally {
		cleanup();
	}
}

function classifyFetchError(error: unknown, ctx: AttemptContext): AttemptOutcome {
	if (isAbortError(error)) {
		if (ctx.config.signal?.aborted) {
			return { ok: false, retryable: false, cause: abortedByCaller(ctx, error) };
		}
		// With no timeout armed, the runtime aborted on its own (e.g. an undici socket teardown):
		// as transient as a network drop, but not a timeout.
		const { timeoutMs } = ctx.config;
		const cause =
			typeof timeoutMs === 'number' && timeoutMs > 0
				? new ComputeError(`Request timed out after ${timeoutMs}ms`, ErrorCodes.TIMEOUT_ERROR, {
						context: { ...ctx.errorContext, timeoutMs },
						originalError: error
					})
				: new ComputeError(
						`Request aborted by the runtime (${error.name}): ${error.message}`,
						ErrorCodes.NETWORK_ERROR,
						{ context: ctx.errorContext, originalError: error }
					);
		return { ok: false, retryable: true, cause };
	}

	if (error instanceof TypeError) {
		// In a browser an opaque fetch TypeError is most often CORS, which the browser hides by
		// design. An offline network throws the same error, so it stays retryable either way.
		const inBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
		const cause = inBrowser
			? new ComputeError(
					`Request failed: ${error.message} — in a browser this usually means a CORS misconfiguration on the server (or a network failure; the browser does not distinguish them)`,
					ErrorCodes.CORS_ERROR,
					{ context: ctx.errorContext, originalError: error }
				)
			: new ComputeError(`Network error: ${error.message}`, ErrorCodes.NETWORK_ERROR, {
					context: ctx.errorContext,
					originalError: error
				});
		return { ok: false, retryable: true, cause };
	}

	if (error instanceof ComputeError) {
		// From handleResponse: a 2xx NETWORK_ERROR is a body cut off mid-stream.
		const status = error.statusCode;
		const truncatedSuccess =
			error.code === ErrorCodes.NETWORK_ERROR &&
			status !== undefined &&
			status >= 200 &&
			status < 300;
		return { ok: false, retryable: truncatedSuccess, cause: error };
	}

	return {
		ok: false,
		retryable: false,
		cause: new ComputeError(
			error instanceof Error ? error.message : String(error),
			ErrorCodes.UNKNOWN_ERROR,
			{
				context: ctx.errorContext,
				originalError: error instanceof Error ? error : new Error(String(error))
			}
		)
	};
}

/**
 * POST `args` as JSON to `<serverUrl>/<endpoint>` with retry, timeout and abort handling, and
 * return the parsed response. Most callers want a higher-level API.
 *
 * `R` names the expected response shape; nothing checks it, so the default `unknown` forces a
 * narrowing.
 *
 * @example
 * const response = await fetchCompute('grasshopper', args, {
 *   serverUrl: 'https://my-server.com',
 *   timeoutMs: 30_000,
 *   retry: { attempts: 2 },
 *   signal: controller.signal
 * });
 */
export async function fetchCompute<R = unknown>(
	endpoint: string,
	args: Record<string, any>,
	config: ComputeConfig
): Promise<R> {
	const requestId = generateRequestId();
	// Fail a circular or BigInt payload as INVALID_INPUT, before anything touches the network.
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
	// UTF-8 bytes: `body.length` counts UTF-16 code units and undercounts non-ASCII payloads.
	const requestSize = utf8ByteLength(body);
	const fullUrl = buildUrl(endpoint, config.serverUrl);
	const headers = buildHeaders(requestId, config);
	const retryPolicy = resolveRetryPolicy(config.retry);
	const totalAttempts = retryPolicy.attempts + 1;

	if (config.debug) {
		const sizeKb = (requestSize / 1024).toFixed(2);
		const emoji = requestSize > 100000 ? '⚠️' : '🚀';
		getLogger().debug(
			`${emoji} Starting compute request [${requestId}]: ${endpoint} (${sizeKb}KB)`
		);
	}

	const ctx: AttemptContext = {
		endpoint,
		body,
		requestSize,
		fullUrl,
		requestId,
		headers,
		config,
		errorContext: { serverUrl: config.serverUrl, url: fullUrl, endpoint, requestId, requestSize }
	};

	for (let attempt = 0; ; attempt++) {
		const isFinal = attempt >= retryPolicy.attempts;
		const result = await attemptFetch(ctx, retryPolicy, attempt, isFinal);

		if (result.ok) return result.value as R;
		if (isFinal || !result.retryable) throw result.cause;

		const delayMs = result.delayMs ?? backoffDelay(attempt, retryPolicy);
		if (config.debug) {
			getLogger().debug(
				`🔁 Request [${requestId}] retrying after ${delayMs}ms (attempt ${attempt + 2}/${totalAttempts}): ${result.cause.message}`
			);
		}

		try {
			await sleep(delayMs, config.signal);
		} catch {
			throw abortedByCaller(ctx, result.cause);
		}
	}
}
