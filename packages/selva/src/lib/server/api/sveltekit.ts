/**
 * The SvelteKit binding for the transport-free handlers in `@selvajs/server/api`.
 *
 * This is the only file in the app that knows both worlds: it turns a
 * `RequestEvent` into an `ApiRequest`, and folds this app's domain errors into
 * the shared envelope. A handler mounted through here names no framework, so
 * the same handler runs under Next or Hono behind a sibling adapter roughly
 * this size.
 */

import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import {
	ApiError,
	ApiErrorCode,
	codeForStatus,
	depsFromConfig,
	runHandler,
	type ApiHandler,
	type ApiRequest,
	type SelvaDeps
} from '@selvajs/server/api';
import { ProviderError } from '@selvajs/platform';
import { getDefinitionService, getOrgAssetService } from '../providers.server';
import { shareLinkCodec } from '../shareLinks/token.server';
import { inviteCodec } from '../invites/token.server';
import { MAX_DEFINITION_FILE_SIZE, MAX_IMAGE_FILE_SIZE } from '../computeLimits';
import { SchemaExtractionError } from '@selvajs/server/definitions';
import { ComputeServerUnconfiguredError } from '../compute/errors';

// Postgres unique-constraint names → friendly explanations. Postgrest surfaces
// the constraint name verbatim, which is useless to end users.
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
	projects_org_name_unique: 'A project with that name already exists in this organization.',
	projects_org_id_slug_key: 'A project with that name already exists in this organization.',
	orgs_slug_key: 'An organization with that slug already exists.',
	definitions_pkey: 'A definition with that ID already exists.'
};

function friendlyConstraintMessage(raw: string): string | null {
	for (const [name, msg] of Object.entries(UNIQUE_CONSTRAINT_MESSAGES)) {
		if (raw.includes(name)) return msg;
	}
	return null;
}

/**
 * This app's domain errors, folded into the shared envelope. Compute
 * unreachable or serving an unreadable schema is operator-side (503); a schema
 * this app cannot parse is the caller's file (422).
 */
export function mapAppError(err: unknown): ApiError | undefined {
	// The access guards in `access.server.ts` throw SvelteKit's `error()`, and
	// must keep doing so: page loads share them and need SvelteKit to render
	// the failure. Without this branch every 403 from a guard would miss
	// `isApiError` and land on the 500 fallback — a silent downgrade that no
	// type or test catches unless it asserts the status.
	if (isHttpError(err)) {
		// `error(status, 'string')` and `error(status, { message, code, fields })`
		// are both in use — the guards throw the first, `apiError` the second.
		// `fields` carries Zod's per-field detail and is the reason this reads
		// the body rather than just the status.
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
	if (err instanceof SchemaExtractionError) {
		return err.kind === 'unreachable' || err.kind === 'malformed'
			? new ApiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message)
			: new ApiError(422, ApiErrorCode.UNPROCESSABLE, err.message);
	}
	if (err instanceof ComputeServerUnconfiguredError) {
		return new ApiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
	}
	if (err instanceof ProviderError) {
		const friendly = friendlyConstraintMessage(err.message);
		return new ApiError(err.statusCode, codeForStatus(err.statusCode), friendly ?? err.message);
	}
	return undefined;
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
			// so a rotated `SELVA_HMAC_KEY` takes effect without a restart.
			tokens: { shareLinks: shareLinkCodec(), invites: inviteCodec() },
			// Passed explicitly: `depsFromConfig` defaults these, and letting the
			// default win would silently ignore this deployment's
			// MAX_*_FILE_SIZE_BYTES.
			uploadLimits: {
				maxDefinitionFileSize: MAX_DEFINITION_FILE_SIZE,
				maxImageFileSize: MAX_IMAGE_FILE_SIZE
			}
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
