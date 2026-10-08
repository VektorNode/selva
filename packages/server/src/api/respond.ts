/**
 * Turn a handler result — or a thrown `ApiError` — into a web-standard
 * `Response`.
 *
 * This is the whole serialization boundary. A host framework that speaks
 * `Request`/`Response` (SvelteKit, Next route handlers, Hono, Remix) needs only
 * to build an `ApiRequest` and call `runHandler`; one that does not can reuse
 * `toErrorBody` and serialize itself.
 */

import { ApiError, ApiErrorCode, isApiError, toErrorBody } from './errors.js';
import type { ApiScopeAction, ScopeTarget } from '@selvajs/platform';
import type { ApiHandler, ApiRequest, ApiResponse } from './types.js';
import { actionForMethod, assertScope } from './scope.js';
import {
	chargeApiRateLimit,
	defaultApiRateLimiter,
	rateLimitedResponse,
	withRateLimitHeaders
} from './rate-limit.js';
import {
	defaultApiIdempotencyStore,
	fingerprintBody,
	idempotencyCallerId,
	readIdempotencyKey,
	requestFingerprint,
	runIdempotent
} from './idempotency.js';

export { toErrorBody, type ApiErrorBody } from './errors.js';

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
	/**
	 * Honour `Idempotency-Key`: a repeat from the same caller replays the first
	 * response, and a key reused with a different body gets 422. Opt in per
	 * route; what is safe to replay differs.
	 */
	idempotent?: boolean;
}

/** Run a handler and serialize whatever comes out, including failures. */
export async function runHandler(
	handler: ApiHandler,
	req: ApiRequest,
	{ fallback, mapError, action, scopeTarget, idempotent }: RunHandlerOptions
): Promise<Response> {
	const fail = (err: unknown): Response => {
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
	};

	let verdict;
	try {
		// Charged before the scope check: `scopeTarget` may read the database,
		// and a throttled key must not reach it.
		const limiter =
			req.deps.apiRateLimiter === undefined ? defaultApiRateLimiter() : req.deps.apiRateLimiter;
		verdict = await chargeApiRateLimit(req.ctx, limiter);
		if (verdict && !verdict.allowed) return rateLimitedResponse(verdict);
	} catch (err) {
		return fail(err);
	}

	let res: Response;
	try {
		if (req.ctx?.apiScope) {
			assertScope(
				req.ctx,
				action ?? actionForMethod(req.request.method),
				scopeTarget ? await scopeTarget(req) : undefined
			);
		}
		const run = async () => {
			try {
				return toResponse(await handler(req));
			} catch (err) {
				return fail(err);
			}
		};
		const clientKey = idempotent && req.ctx ? readIdempotencyKey(req.request) : null;
		if (clientKey && req.ctx) {
			const fingerprint = await requestFingerprint(
				req.request.method,
				req.url.pathname + req.url.search,
				await fingerprintBody(req.request)
			);
			res = await runIdempotent(
				{
					store: req.deps.idempotency ?? defaultApiIdempotencyStore(),
					callerId: idempotencyCallerId(req.ctx),
					clientKey,
					fingerprint
				},
				run
			);
		} else {
			res = await run();
		}
	} catch (err) {
		res = fail(err);
	}
	return withRateLimitHeaders(res, verdict);
}
