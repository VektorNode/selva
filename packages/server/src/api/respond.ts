/**
 * Turn a handler result — or a thrown `ApiError` — into a web-standard
 * `Response`.
 *
 * This is the whole serialization boundary. A host framework that speaks
 * `Request`/`Response` (SvelteKit, Next route handlers, Hono, Remix) needs only
 * to build an `ApiRequest` and call `runHandler`; one that does not can reuse
 * `toErrorBody` and serialize itself.
 */

import { ApiError, ApiErrorCode, isApiError } from './errors.js';
import type { ApiHandler, ApiRequest, ApiResponse } from './types.js';

export interface ApiErrorBody {
	message: string;
	code: ApiErrorCode;
	fields?: Record<string, string>;
}

export function toErrorBody(err: ApiError): ApiErrorBody {
	return err.fields
		? { message: err.message, code: err.code, fields: err.fields }
		: { message: err.message, code: err.code };
}

function toResponse(result: ApiResponse | Response): Response {
	if (result instanceof Response) return result;

	const { status, body, headers } = result;
	if (body === undefined) return new Response(null, { status: status ?? 204, headers });

	return new Response(JSON.stringify(body), {
		status: status ?? 200,
		headers: { 'content-type': 'application/json', ...headers }
	});
}

/**
 * Run a handler and serialize whatever comes out, including failures.
 *
 * `mapError` lets a host fold its own domain errors into the envelope before
 * the 500 fallback — the Selva app maps `ProviderError`, `SchemaExtractionError`
 * and `ComputeServerUnconfiguredError` this way, none of which belong here.
 */
export async function runHandler(
	handler: ApiHandler,
	req: ApiRequest,
	{ fallback, mapError }: { fallback: string; mapError?: (err: unknown) => ApiError | undefined }
): Promise<Response> {
	try {
		return toResponse(await handler(req));
	} catch (err) {
		if (isApiError(err)) {
			return toResponse({ status: err.status, body: toErrorBody(err) });
		}

		const mapped = mapError?.(err);
		if (mapped) {
			return toResponse({ status: mapped.status, body: toErrorBody(mapped) });
		}

		// Never `console.error(…, err)`: provider adapters stash connection
		// details on `cause`, and a raw console call hands the whole object to
		// stdout where redaction never runs.
		req.log.error(`[API] ${fallback}`, {
			component: 'api',
			err: err instanceof Error ? (err.stack ?? err.message) : String(err)
		});

		return toResponse({
			status: 500,
			body: { message: fallback, code: ApiErrorCode.INTERNAL }
		});
	}
}
