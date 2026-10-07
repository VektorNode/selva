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
import type { ApiScopeAction, ScopeTarget } from '@selvajs/platform';
import type { ApiHandler, ApiRequest, ApiResponse } from './types.js';
import { actionForMethod, assertScope } from './scope.js';

export interface ApiErrorBody {
	message: string;
	code: ApiErrorCode;
	fields?: Record<string, string>;
	details?: Record<string, string>;
}

export function toErrorBody(err: ApiError): ApiErrorBody {
	const body: ApiErrorBody = { message: err.message, code: err.code };
	if (err.fields) body.fields = err.fields;
	if (err.details) body.details = err.details;
	return body;
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

export interface RunHandlerOptions {
	/** The 500 message when the handler throws something unmapped. */
	fallback: string;
	/**
	 * Folds a host's own domain errors into the envelope before the 500 fallback.
	 * The Selva app maps `ProviderError`, `SchemaExtractionError` and
	 * `ComputeServerUnconfiguredError` this way, none of which belong here.
	 */
	mapError?: (err: unknown) => ApiError | undefined;
	/**
	 * What the route does, for API-token scope checks. Defaults from the method:
	 * `GET`/`HEAD` are `read`, everything else `write`. Solve routes say `solve`.
	 */
	action?: ApiScopeAction;
	/**
	 * The project or definition the route touches. Without it the scope check is
	 * org-level, which project- and definition-scoped keys never pass.
	 */
	scopeTarget?: (req: ApiRequest) => ScopeTarget | Promise<ScopeTarget>;
}

/** Run a handler and serialize whatever comes out, including failures. */
export async function runHandler(
	handler: ApiHandler,
	req: ApiRequest,
	{ fallback, mapError, action, scopeTarget }: RunHandlerOptions
): Promise<Response> {
	try {
		if (req.ctx?.apiScope) {
			assertScope(
				req.ctx,
				action ?? actionForMethod(req.request.method),
				scopeTarget ? await scopeTarget(req) : undefined
			);
		}
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
