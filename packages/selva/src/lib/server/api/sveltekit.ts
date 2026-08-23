/**
 * The SvelteKit binding for the transport-free handlers in `@selvajs/server/api`.
 *
 * The only file in the app that knows both worlds: it turns a `RequestEvent`
 * into an `ApiRequest` and folds this app's domain errors into the shared
 * envelope. A handler mounted through here names no framework, so the same
 * handler runs under Next or Hono behind a sibling adapter roughly this size.
 */

import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import {
	ApiError,
	ApiErrorCode,
	codeForStatus,
	depsFromConfig,
	mapCoreError,
	runHandler,
	type ApiHandler,
	type ApiRequest,
	type SelvaDeps
} from '@selvajs/server/api';
import {
	getBranding,
	getDefinitionService,
	getNotificationProvider,
	getOrgAssetService
} from '../providers.server';
import { shareLinkCodec } from '../shareLinks/token.server';
import { inviteCodec } from '../invites/token.server';
import { MAX_DEFINITION_FILE_SIZE, MAX_IMAGE_FILE_SIZE } from '../computeLimits';
import { evictComputeClient } from '../compute/engine.server';

/**
 * This app's own errors, folded into the shared envelope.
 *
 * SvelteKit's `HttpError` is the only one left here — everything else the v1
 * handlers throw ships from `@selvajs/server`, so `mapCoreError` owns those
 * rules and a second host gets the same statuses without copying them.
 */
export function mapAppError(err: unknown): ApiError | undefined {
	// Access guards in `access.server.ts` throw SvelteKit's error() and must
	// keep doing so — page loads share them and need SvelteKit to render the
	// failure. Without this branch every guard 403 falls through to the 500
	// fallback, a downgrade no type check catches.
	if (isHttpError(err)) {
		// Guards throw `error(status, 'string')`; `apiError` throws the object
		// form with `fields` (Zod's per-field detail) — both are live, so this
		// reads the body rather than just the status.
		const body = err.body as
			{ message?: string; code?: ApiErrorCode; fields?: Record<string, string> } | string;
		if (typeof body === 'string') {
			return new ApiError(err.status, codeForStatus(err.status), body);
		}
		return new ApiError(
			err.status,
			body?.code ?? codeForStatus(err.status),
			body?.message ?? 'Request failed',
			body?.fields
		);
	}
	return mapCoreError(err);
}

// Providers resolve lazily and memoize, so building deps per request costs a
// few property reads — no provider is constructed here.
function buildDeps(event: RequestEvent): SelvaDeps {
	return depsFromConfig(
		event.locals.providers,
		{
			definitions: getDefinitionService(),
			orgAssets: getOrgAssetService()
		},
		{
			// Resolved per request, not captured: both codecs re-key on the secret,
			// so a rotated SELVA_HMAC_KEY takes effect without a restart.
			tokens: { shareLinks: shareLinkCodec(), invites: inviteCodec() },
			// Passed explicitly — depsFromConfig's defaults would silently ignore
			// this deployment's MAX_*_FILE_SIZE_BYTES.
			uploadLimits: {
				maxDefinitionFileSize: MAX_DEFINITION_FILE_SIZE,
				maxImageFileSize: MAX_IMAGE_FILE_SIZE
			},
			// Cache is keyed on server id; without this a compute-config write
			// leaves a warm client holding a rotated URL or key.
			evictComputeClient,
			notifications: getNotificationProvider(),
			instanceName: getBranding().name
		}
	);
}

export function toApiRequest(event: RequestEvent): ApiRequest {
	return {
		ctx: event.locals.ctx,
		user: event.locals.user,
		profile: event.locals.profile,
		log: event.locals.log,
		params: event.params,
		url: event.url,
		request: event.request,
		deps: buildDeps(event)
	};
}

/** Mount a transport-free handler as a SvelteKit `RequestHandler`. */
export function mount(fallback: string, handler: ApiHandler) {
	return (event: RequestEvent): Promise<Response> =>
		runHandler(handler, toApiRequest(event), { fallback, mapError: mapAppError });
}
