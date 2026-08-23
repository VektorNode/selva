import { ComputeError, ErrorCodes, type ErrorCode } from '../errors';
import { log } from './log';
import { fireServerTiming } from './server-timing';
import { setResponseWireSize } from './wire-size';

import type { ServerErrorCodeMap, ServerTiming } from '../types';

/** Upper bound for the raw server body stored on error `context.responseBody`. */
const MAX_CONTEXT_BODY_CHARS = 4096;

/** Truncate a server body for storage on error context — bounded, with an honest marker. */
function truncateBody(body: string): string {
	if (body.length <= MAX_CONTEXT_BODY_CHARS) return body;
	return `${body.slice(0, MAX_CONTEXT_BODY_CHARS)}… [truncated ${body.length - MAX_CONTEXT_BODY_CHARS} chars]`;
}

export function throwHttpError(
	response: Response,
	fullUrl: string,
	requestId: string,
	requestSize: number,
	serverUrl: string,
	errorBody: string,
	serverCode?: string,
	rawBody?: string,
	serverErrorCodes?: ServerErrorCodeMap
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

	// A machine code in the server's error body outranks the status-based mapping:
	// it's stable across the server's production message-scrubbing, where the human
	// message is replaced with a generic string. Keep the status-derived message
	// for context.
	const code = mapServerErrorCode(serverCode, serverErrorCodes) ?? error.code;

	throw new ComputeError(error.message, code, { statusCode: status, context });
}

/**
 * Map a server-supplied error code (from the JSON error body's `code` field) to
 * one of our {@link ErrorCodes}. Returns `undefined` for an absent or unknown
 * code so the caller falls back to its status-based mapping.
 *
 * Which wire codes exist is backend-specific, so the table comes from the caller
 * ({@link ComputeConfig.serverErrorCodes}) — core does not know any of them.
 */
export function mapServerErrorCode(
	serverCode?: string,
	serverErrorCodes?: ServerErrorCodeMap
): ErrorCode | undefined {
	if (!serverCode || !serverErrorCodes) return undefined;
	return serverErrorCodes[serverCode];
}

export async function handleResponse(
	response: Response,
	fullUrl: string,
	requestId: string,
	requestSize: number,
	serverUrl: string,
	startTime: number,
	debug?: boolean,
	onServerTiming?: (timing: ServerTiming, requestId: string) => void,
	serverErrorCodes?: ServerErrorCodeMap
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

		// A machine-readable code the server may tag onto its error body. Unlike the
		// human `message`, it isn't scrubbed in the server's production (non-debug)
		// mode, so it's the reliable signal for classifying the error (see
		// throwHttpError → mapServerErrorCode). It can ride any error status, not
		// just 500, so read it here.
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
					setResponseWireSize(parsed, errorBody.length);
					if (debug) {
						log(
							`⚠️ Request [${requestId}] completed with solver errors in ${responseTime}ms`,
							true
						);
						if (parsed.errors?.length > 0) {
							log(`   Errors: ${JSON.stringify(parsed.errors, null, 2)}`, true);
						}
						if (parsed.warnings?.length > 0) {
							log(`   Warnings: ${JSON.stringify(parsed.warnings, null, 2)}`, true);
						}
					}
					fireServerTiming(response, requestId, onServerTiming, debug);
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
			rawBody,
			serverErrorCodes
		);
	}

	log(`✅ Request [${requestId}] completed in ${responseTime}ms`, debug);

	fireServerTiming(response, requestId, onServerTiming, debug);

	try {
		// text-then-parse (what `response.json()` does internally) so the body's
		// wire size rides along with the parsed object — downstream byte-budgeted
		// caches read it instead of re-serializing a potentially huge tree.
		const rawBody = await response.text();
		const parsed = JSON.parse(rawBody);
		setResponseWireSize(parsed, rawBody.length);
		return parsed;
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
			throw new ComputeError(
				`Server returned a non-JSON response (Content-Type: ${contentType}) — check the server URL / proxy configuration`,
				ErrorCodes.INVALID_RESPONSE,
				{
					statusCode: response.status,
					context: { url: fullUrl, requestId, contentType },
					originalError: error instanceof Error ? error : new Error(String(error))
				}
			);
		}
		throw new ComputeError('Failed to parse JSON response', ErrorCodes.NETWORK_ERROR, {
			statusCode: response.status,
			context: {
				url: fullUrl,
				requestId
			},
			originalError: error instanceof Error ? error : new Error(String(error))
		});
	}
}
