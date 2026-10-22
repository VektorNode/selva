import { ComputeError, ErrorCodes, type ErrorCode } from '../errors';
import { getLogger } from '../utils/logger';
import { readField } from '../utils/read-field';
import { fireServerTiming } from './server-timing';
import { isAbortError } from './signal';
import { setResponseWireSize } from './wire-size';

import type { ComputeConfig } from '../types';

export interface RequestContext {
	fullUrl: string;
	requestId: string;
	requestSize: number;
	config: ComputeConfig;
}

/** Upper bound for the raw server body stored on error `context.responseBody`. */
const MAX_CONTEXT_BODY_CHARS = 4096;

function truncateBody(body: string): string {
	if (body.length <= MAX_CONTEXT_BODY_CHARS) return body;
	return `${body.slice(0, MAX_CONTEXT_BODY_CHARS)}… [truncated ${body.length - MAX_CONTEXT_BODY_CHARS} chars]`;
}

/**
 * `rawBody` is what came over the wire and goes on `context.responseBody`; `detail` may be a
 * message rewritten from it and only feeds the error message.
 */
function throwHttpError(
	response: Response,
	ctx: RequestContext,
	rawBody: string,
	detail: string,
	serverCode: string | undefined
): never {
	const { status, statusText } = response;
	const { fullUrl, requestId, requestSize, config } = ctx;

	const responseHeaders: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		responseHeaders[key] = value;
	});

	const trimmed = detail.trim();
	const bodyHint = trimmed ? ` — ${trimmed.slice(0, 200)}${trimmed.length > 200 ? '…' : ''}` : '';

	const context = {
		url: fullUrl,
		requestId,
		method: 'POST',
		requestSize,
		serverUrl: config.serverUrl,
		responseBody: rawBody ? truncateBody(rawBody) : undefined,
		responseHeaders
	};

	const errorMap: Record<number, { message: string; code: ErrorCode }> = {
		400: {
			message: `Bad request: ${statusText}${bodyHint}`,
			code: ErrorCodes.VALIDATION_ERROR
		},
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
			message: `Bad gateway: ${statusText}${bodyHint}`,
			code: ErrorCodes.NETWORK_ERROR
		},
		503: {
			message: `Service unavailable: ${statusText}${bodyHint}`,
			code: ErrorCodes.NETWORK_ERROR
		},
		504: {
			message: `Gateway timeout: ${statusText}${bodyHint}`,
			code: ErrorCodes.NETWORK_ERROR
		}
	};

	const error = errorMap[status] || {
		message: `HTTP ${status}: ${statusText}${bodyHint}`,
		code: ErrorCodes.UNKNOWN_ERROR
	};

	const codes = config.serverErrorCodes;
	// The code is server-supplied: `constructor` must not resolve through the prototype.
	const serverMapped =
		serverCode && codes && Object.prototype.hasOwnProperty.call(codes, serverCode)
			? codes[serverCode]
			: undefined;

	throw new ComputeError(error.message, serverMapped ?? error.code, {
		statusCode: status,
		context
	});
}

export async function handleResponse(
	response: Response,
	ctx: RequestContext,
	startTime: number
): Promise<unknown> {
	const { requestId, config } = ctx;
	const { debug, onServerTiming } = config;
	const responseTime = Math.round(performance.now() - startTime);

	if (!response.ok) {
		const rawBody = await response.text();

		if (debug) {
			const logger = getLogger();
			logger.debug(
				`❌ Request [${requestId}] failed with HTTP ${response.status} in ${responseTime}ms`
			);
			logger.debug(`   URL: ${ctx.fullUrl}`);
			logger.debug(`   Status: ${response.status} ${response.statusText}`);
			if (rawBody) {
				logger.debug(
					`   Response body: ${rawBody.substring(0, 500)}${rawBody.length > 500 ? '...' : ''}`
				);
			}
		}

		let parsed: any;
		let isJson = true;
		try {
			parsed = JSON.parse(rawBody);
		} catch (e) {
			isJson = false;
			if (debug && response.status === 500) {
				getLogger().debug(`   Failed to parse error body as JSON: ${e}`);
			}
		}

		// Any error status can carry a `code`, not just 500.
		const serverCode: string | undefined =
			typeof parsed?.code === 'string' ? parsed.code : undefined;
		let detail = rawBody;

		if (response.status === 500 && isJson) {
			// Values plus errors or warnings: the solve ran, so this is a partial success.
			const values = readField(parsed, 'values');
			const solveErrors = readField<unknown[]>(parsed, 'errors');
			const solveWarnings = readField<unknown[]>(parsed, 'warnings');
			if (values && (solveErrors || solveWarnings)) {
				setResponseWireSize(parsed, rawBody.length);
				if (debug) {
					const logger = getLogger();
					logger.debug(
						`⚠️ Request [${requestId}] completed with solver errors in ${responseTime}ms`
					);
					if (solveErrors && solveErrors.length > 0) {
						logger.debug(`   Errors: ${JSON.stringify(solveErrors, null, 2)}`);
					}
					if (solveWarnings && solveWarnings.length > 0) {
						logger.debug(`   Warnings: ${JSON.stringify(solveWarnings, null, 2)}`);
					}
				}
				fireServerTiming(response, requestId, onServerTiming, debug);
				return parsed;
			}

			// Compute8's exception handler sends `{ error, message: "<category>: <detail>",
			// stackTrace? }`; older servers sent PascalCase `Message`/`ExceptionType`/`StackTrace`.
			const serverMessage =
				(typeof parsed?.message === 'string' && parsed.message) ||
				(typeof parsed?.Message === 'string' && parsed.Message) ||
				'';
			const exceptionType =
				(typeof parsed?.ExceptionType === 'string' && parsed.ExceptionType) || '';
			const stack = parsed?.stackTrace ?? parsed?.StackTrace;
			const stackStr = Array.isArray(stack) ? stack.join('\n') : stack || '';

			if (serverMessage) {
				const prefix = exceptionType ? `${exceptionType}: ` : '';
				detail = `${prefix}${serverMessage}${stackStr ? `\n${stackStr}` : ''}`;
			} else if (parsed?.error) {
				detail =
					typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error, null, 2);
			}
		}

		throwHttpError(response, ctx, rawBody, detail, serverCode);
	}

	if (debug) getLogger().debug(`✅ Request [${requestId}] completed in ${responseTime}ms`);

	fireServerTiming(response, requestId, onServerTiming, debug);

	try {
		// Text, then parse, so the wire size rides along for byte-budgeted caches.
		const rawBody = await response.text();
		const parsed = JSON.parse(rawBody);
		setResponseWireSize(parsed, rawBody.length);
		return parsed;
	} catch (error) {
		// The signal stays armed while the body streams: an abort here is the caller's or the
		// timeout's, not a truncated body.
		if (isAbortError(error)) throw error;
		// A declared non-JSON body (captive portal, proxy login page) comes back identical on a
		// retry. Anything else that fails to parse was most likely cut off mid-stream.
		const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase();
		const declaredNonJson = contentType !== '' && !contentType.includes('json');
		if (declaredNonJson) {
			throw new ComputeError(
				`Server returned a non-JSON response (Content-Type: ${contentType}) — check the server URL / proxy configuration`,
				ErrorCodes.INVALID_RESPONSE,
				{
					statusCode: response.status,
					context: { url: ctx.fullUrl, requestId, contentType },
					originalError: error instanceof Error ? error : new Error(String(error))
				}
			);
		}
		throw new ComputeError('Failed to parse JSON response', ErrorCodes.NETWORK_ERROR, {
			statusCode: response.status,
			context: { url: ctx.fullUrl, requestId },
			originalError: error instanceof Error ? error : new Error(String(error))
		});
	}
}
