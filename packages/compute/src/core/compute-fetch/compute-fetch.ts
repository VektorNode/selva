import { abortedByCaller, ComputeError, ErrorCodes } from '../errors';
import { utf8ByteLength } from '../utils/encoding';
import { getLogger } from '../utils/logger';
import { validateServerUrl } from '../server/validate-server-url';
import { ERROR_BODY_MAX_BYTES, readBodyText } from './read-body';
import { buildUrl, buildHeaders, generateRequestId } from './request';
import { gzip, noteRequestEncodings, shouldGzipRequest } from './request-compression';
import { handleResponse, type AttemptOutcome, type RequestContext } from './response';
import { backoffDelay, isRetryableStatus, resolveRetryPolicy, retryDelay, sleep } from './retry';
import { composeSignal, isAbortError, MAX_TIMEOUT_MS } from './signal';

import type { ComputeConfig, RetryPolicy } from '../types';

interface AttemptContext extends RequestContext {
	endpoint: string;
	/** Validated: the key request compression is remembered under. */
	serverUrl: string;
	body: string;
	headers: Record<string, string>;
	errorContext: Record<string, unknown>;
}

async function attemptFetch(
	ctx: AttemptContext,
	policy: Required<RetryPolicy>,
	attempt: number,
	isFinal: boolean
): Promise<AttemptOutcome> {
	const { signal, cleanup } = composeSignal(ctx.config.signal, ctx.config.timeoutMs);
	const startTime = performance.now();
	const send = ctx.config.fetch ?? fetch;

	try {
		const gzipped = shouldGzipRequest(ctx.serverUrl, ctx.requestSize) ? await gzip(ctx.body) : null;
		const response = await send(ctx.fullUrl, {
			method: 'POST',
			body: gzipped ?? ctx.body,
			headers: gzipped ? { ...ctx.headers, 'Content-Encoding': 'gzip' } : ctx.headers,
			signal,
			// handleResponse rejects a redirect rather than let the API key follow it.
			redirect: 'manual'
		});
		noteRequestEncodings(ctx.serverUrl, response);

		if (!isFinal && isRetryableStatus(response.status, policy)) {
			// Drain so the connection can be reused. The final attempt skips this branch so
			// handleResponse reads the body into the error instead.
			await readBodyText(response, ERROR_BODY_MAX_BYTES).catch(() => {});
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

		return await handleResponse(response, ctx, startTime);
	} catch (error) {
		return classifyFetchError(error, ctx);
	} finally {
		cleanup();
	}
}

function classifyFetchError(error: unknown, ctx: AttemptContext): AttemptOutcome {
	if (error instanceof ComputeError) return { ok: false, retryable: false, cause: error };

	// Fetch rejects with `signal.reason`, and a caller can abort with anything.
	if (ctx.config.signal?.aborted) {
		return { ok: false, retryable: false, cause: abortedByCaller(ctx.errorContext, error) };
	}

	if (isAbortError(error)) {
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

	return {
		ok: false,
		retryable: false,
		cause: new ComputeError(
			error instanceof Error ? error.message : String(error),
			ErrorCodes.UNKNOWN_ERROR,
			{
				context: ctx.errorContext,
				originalError: error
			}
		)
	};
}

function requireNumber(
	name: string,
	value: number | undefined,
	isValid: (n: number) => boolean
): void {
	if (value !== undefined && !isValid(value)) {
		throw new ComputeError(`${name} is not usable: ${value}`, ErrorCodes.INVALID_CONFIG, {
			context: { [name]: value }
		});
	}
}

/** `NaN` fails every comparison, so unchecked it disables a loop's exit or a limit. */
export function validateNumbers({ timeoutMs, maxResponseBytes, retry }: ComputeConfig): void {
	const notNegative = (n: number) => n >= 0;
	requireNumber('timeoutMs', timeoutMs, (n) => n <= MAX_TIMEOUT_MS);
	requireNumber('maxResponseBytes', maxResponseBytes, notNegative);
	requireNumber('retry.attempts', retry?.attempts, (n) => notNegative(n) && Number.isFinite(n));
	requireNumber('retry.baseDelayMs', retry?.baseDelayMs, notNegative);
	requireNumber('retry.maxDelayMs', retry?.maxDelayMs, notNegative);
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
				originalError: error
			}
		);
	}
	// UTF-8 bytes: `body.length` counts UTF-16 code units and undercounts non-ASCII payloads.
	const requestSize = utf8ByteLength(body);
	// Shape only: which hosts to block is the backend's call, made where its client is built.
	const serverUrl = validateServerUrl(config.serverUrl, { blockedHosts: [] });
	validateNumbers(config);
	const fullUrl = buildUrl(endpoint, serverUrl);
	const headers = buildHeaders(requestId, config);
	const retryPolicy = resolveRetryPolicy(config.retry);
	const totalAttempts = retryPolicy.attempts + 1;

	if (config.debug) {
		const sizeKb = (requestSize / 1024).toFixed(2);
		getLogger().debug(`Starting compute request [${requestId}]: ${endpoint} (${sizeKb}KB)`);
	}

	const ctx: AttemptContext = {
		endpoint,
		serverUrl,
		body,
		requestSize,
		fullUrl,
		requestId,
		headers,
		config,
		errorContext: { serverUrl, url: fullUrl, endpoint, requestId, requestSize }
	};

	for (let attempt = 0; ; attempt++) {
		const isFinal = attempt >= retryPolicy.attempts;
		const result = await attemptFetch(ctx, retryPolicy, attempt, isFinal);

		if (result.ok) return result.value as R;
		if (isFinal || !result.retryable) throw result.cause;

		const delayMs = result.delayMs ?? backoffDelay(attempt, retryPolicy);
		if (config.debug) {
			getLogger().debug(
				`Request [${requestId}] retrying after ${delayMs}ms (attempt ${attempt + 2}/${totalAttempts}): ${result.cause.code}`
			);
		}

		try {
			await sleep(delayMs, config.signal);
		} catch {
			throw abortedByCaller(ctx.errorContext, result.cause);
		}
	}
}
