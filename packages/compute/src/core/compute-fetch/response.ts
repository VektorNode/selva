import { ComputeError, ErrorCodes, type ErrorCode } from '../errors';
import { getLogger } from '../utils/logger';
import { readField } from '../utils/read-field';
import { tryParseJson } from '../utils/try-parse-json';
import { fireServerTiming } from './server-timing';
import { ERROR_BODY_MAX_BYTES, readBodyText } from './read-body';
import { isAbortError } from './signal';
import { setResponseWireSize } from './wire-size';

import type { ComputeConfig } from '../types';

export interface RequestContext {
	fullUrl: string;
	requestId: string;
	requestSize: number;
	config: ComputeConfig;
}

export type AttemptOutcome =
	| { ok: true; value: unknown }
	| { ok: false; cause: ComputeError; retryable: boolean; delayMs?: number };

/** Upper bound for the raw server body stored on error `context.responseBody`. */
const MAX_CONTEXT_BODY_CHARS = 4096;

/** An allowlist: errors reach logs and telemetry, and `Set-Cookie` or a proxy's token must not. */
const CONTEXT_HEADERS = [
	'content-length',
	'content-type',
	'retry-after',
	'server-timing',
	'www-authenticate',
	'x-request-id'
];

function truncateBody(body: string): string {
	if (body.length <= MAX_CONTEXT_BODY_CHARS) return body;
	return `${body.slice(0, MAX_CONTEXT_BODY_CHARS)}… [truncated ${body.length - MAX_CONTEXT_BODY_CHARS} chars]`;
}

function contextHeaders(headers: Headers): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const name of CONTEXT_HEADERS) {
		const value = headers.get(name);
		if (value !== null) kept[name] = value;
	}
	return kept;
}

interface HttpFailure {
	status: number;
	statusText: string;
	bodyHint: string;
	fullUrl: string;
	requestSize: number;
}

interface StatusRule {
	code: ErrorCode;
	/** Omitted: {@link plainMessage}. */
	message?: (failure: HttpFailure) => string;
}

const plainMessage = ({ status, statusText, bodyHint }: HttpFailure) =>
	`HTTP ${status}: ${statusText}${bodyHint}`;

const labelled =
	(label: string) =>
	({ statusText, bodyHint }: HttpFailure) =>
		`${label}: ${statusText}${bodyHint}`;

const STATUS_RULES: Record<number, StatusRule> = {
	400: { code: ErrorCodes.VALIDATION_ERROR, message: labelled('Bad request') },
	401: { code: ErrorCodes.AUTH_ERROR },
	403: { code: ErrorCodes.AUTH_ERROR },
	404: {
		code: ErrorCodes.NOT_FOUND,
		message: ({ fullUrl }) => `Endpoint not found: ${fullUrl}`
	},
	413: {
		code: ErrorCodes.VALIDATION_ERROR,
		message: ({ requestSize }) => `Request too large: ${(requestSize / 1024).toFixed(2)}KB`
	},
	429: {
		code: ErrorCodes.RATE_LIMIT,
		message: ({ bodyHint }) => `Rate limit exceeded${bodyHint}`
	},
	500: { code: ErrorCodes.COMPUTATION_ERROR, message: labelled('Server error') },
	502: { code: ErrorCodes.NETWORK_ERROR, message: labelled('Bad gateway') },
	503: { code: ErrorCodes.NETWORK_ERROR, message: labelled('Service unavailable') },
	504: { code: ErrorCodes.NETWORK_ERROR, message: labelled('Gateway timeout') }
};

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

	const trimmed = detail.trim();
	const bodyHint = trimmed ? ` — ${trimmed.slice(0, 200)}${trimmed.length > 200 ? '…' : ''}` : '';

	const rule: StatusRule = STATUS_RULES[status] ?? { code: ErrorCodes.UNKNOWN_ERROR };
	const message = (rule.message ?? plainMessage)({
		status,
		statusText,
		bodyHint,
		fullUrl,
		requestSize
	});

	const codes = config.serverErrorCodes;
	// The code is server-supplied: `constructor` must not resolve through the prototype.
	const serverMapped =
		serverCode && codes && Object.hasOwn(codes, serverCode) ? codes[serverCode] : undefined;

	throw new ComputeError(message, serverMapped ?? rule.code, {
		statusCode: status,
		context: {
			url: fullUrl,
			requestId,
			method: 'POST',
			requestSize,
			serverUrl: config.serverUrl,
			responseBody: rawBody ? truncateBody(rawBody) : undefined,
			responseHeaders: contextHeaders(response.headers)
		}
	});
}

/** A 3xx, or a browser's `redirect: 'manual'` stand-in for one, which hides the status. */
export function isRedirect(response: Response): boolean {
	return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

/** Following a redirect would send the API key header, which fetch keeps cross-origin, to the target. */
function redirectError(response: Response, ctx: RequestContext): ComputeError {
	const location = response.headers.get('Location') ?? undefined;
	return new ComputeError(
		`Server redirected the request${location ? ` to ${location}` : ''}. Redirects are not followed, ` +
			'so credentials never leave serverUrl: set serverUrl to the address it redirects to.',
		ErrorCodes.INVALID_CONFIG,
		{
			...(response.status > 0 && { statusCode: response.status }),
			context: { url: ctx.fullUrl, requestId: ctx.requestId, location }
		}
	);
}

function tooLargeError(response: Response, ctx: RequestContext): ComputeError {
	const { maxResponseBytes } = ctx.config;
	return new ComputeError(
		`Response body exceeded maxResponseBytes (${maxResponseBytes} bytes)`,
		ErrorCodes.RESPONSE_TOO_LARGE,
		{
			statusCode: response.status,
			context: { url: ctx.fullUrl, requestId: ctx.requestId, maxResponseBytes }
		}
	);
}

/** Sizes and identifiers only: bodies and solver messages can hold user data. */
function logDebug(ctx: RequestContext, message: string): void {
	if (ctx.config.debug) getLogger().debug(`Request [${ctx.requestId}] ${message}`);
}

/** Values plus errors or warnings: the solve ran, so this 500 is a partial success. */
function partialSuccessCounts(parsed: unknown): { errors: number; warnings: number } | null {
	const solveErrors = readField<unknown[]>(parsed, 'errors');
	const solveWarnings = readField<unknown[]>(parsed, 'warnings');
	if (!readField(parsed, 'values') || !(solveErrors || solveWarnings)) return null;
	return { errors: solveErrors?.length ?? 0, warnings: solveWarnings?.length ?? 0 };
}

/**
 * Compute8's exception handler sends `{ error, message: "<category>: <detail>", stackTrace? }`;
 * older servers sent PascalCase `Message`/`ExceptionType`/`StackTrace`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an unvalidated error body, read defensively
function serverErrorDetail(parsed: any): string | undefined {
	const serverMessage =
		(typeof parsed?.message === 'string' && parsed.message) ||
		(typeof parsed?.Message === 'string' && parsed.Message) ||
		'';
	if (serverMessage) {
		const exceptionType = (typeof parsed?.ExceptionType === 'string' && parsed.ExceptionType) || '';
		const prefix = exceptionType ? `${exceptionType}: ` : '';
		const stack = parsed?.stackTrace ?? parsed?.StackTrace;
		const stackStr = Array.isArray(stack) ? stack.join('\n') : stack || '';
		return `${prefix}${serverMessage}${stackStr ? `\n${stackStr}` : ''}`;
	}
	if (parsed?.error) {
		return typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error, null, 2);
	}
	return undefined;
}

async function handleErrorStatus(
	response: Response,
	ctx: RequestContext,
	responseTime: number
): Promise<AttemptOutcome> {
	const { maxResponseBytes = Infinity, onServerTiming } = ctx.config;
	const isServerError = response.status === 500;
	const { text: rawBody, truncated } = await readBodyText(
		response,
		isServerError ? maxResponseBytes : Math.min(ERROR_BODY_MAX_BYTES, maxResponseBytes)
	);
	if (truncated && isServerError) throw tooLargeError(response, ctx);

	logDebug(
		ctx,
		`failed with HTTP ${response.status} in ${responseTime}ms (${rawBody.length} chars)`
	);

	const parsed = truncated ? undefined : tryParseJson(rawBody);
	let detail = rawBody;

	if (isServerError && parsed !== undefined) {
		const partial = partialSuccessCounts(parsed);
		if (partial) {
			setResponseWireSize(parsed, rawBody.length);
			logDebug(
				ctx,
				`completed in ${responseTime}ms with ${partial.errors} solver error(s), ${partial.warnings} warning(s)`
			);
			fireServerTiming(response, ctx.requestId, onServerTiming);
			return { ok: true, value: parsed };
		}
		detail = serverErrorDetail(parsed) ?? rawBody;
	}

	// Any error status can carry a `code`, not just 500.
	const code = (parsed as { code?: unknown } | null | undefined)?.code;
	throwHttpError(response, ctx, rawBody, detail, typeof code === 'string' ? code : undefined);
}

async function parseSuccessBody(response: Response, ctx: RequestContext): Promise<AttemptOutcome> {
	const { maxResponseBytes = Infinity, signal } = ctx.config;
	try {
		// Text, then parse, so the wire size rides along for byte-budgeted caches.
		const { text: rawBody, truncated } = await readBodyText(response, maxResponseBytes);
		if (truncated) throw tooLargeError(response, ctx);
		const parsed = JSON.parse(rawBody);
		setResponseWireSize(parsed, rawBody.length);
		return { ok: true, value: parsed };
	} catch (error) {
		// The signal stays armed while the body streams: an abort here is the caller's or the
		// timeout's, not a truncated body. A caller can abort with any reason, so ask the signal.
		if (signal?.aborted || isAbortError(error) || error instanceof ComputeError) throw error;
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
					context: { url: ctx.fullUrl, requestId: ctx.requestId, contentType },
					originalError: error
				}
			);
		}
		return {
			ok: false,
			retryable: true,
			cause: new ComputeError('Failed to parse JSON response', ErrorCodes.NETWORK_ERROR, {
				statusCode: response.status,
				context: { url: ctx.fullUrl, requestId: ctx.requestId },
				originalError: error
			})
		};
	}
}

/** Throws a {@link ComputeError} for anything a retry can't fix. */
export async function handleResponse(
	response: Response,
	ctx: RequestContext,
	startTime: number
): Promise<AttemptOutcome> {
	const responseTime = Math.round(performance.now() - startTime);

	if (isRedirect(response)) {
		await response.body?.cancel().catch(() => {});
		throw redirectError(response, ctx);
	}

	if (!response.ok) return handleErrorStatus(response, ctx, responseTime);

	logDebug(ctx, `completed in ${responseTime}ms`);
	fireServerTiming(response, ctx.requestId, ctx.config.onServerTiming);
	return parseSuccessBody(response, ctx);
}
