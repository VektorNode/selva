import type {
	ApiToken,
	AuthUser,
	IAuthProvider,
	IDataProvider,
	ILogger,
	RequestContext
} from '@selvajs/platform';
import { SYSTEM_CONTEXT, narrowApiTokenContext } from '@selvajs/platform';
import { ApiErrorCode } from '../api/errors.js';
import {
	API_TOKEN_PREFIX,
	looksLikeApiToken,
	type ApiTokenCodec
} from '../tokens/api-token-codec.js';
import { buildRequestContext } from './request-context.js';

export type ApiTokenResolution =
	/** No API token on the request. Carry on with the cookie or proxy path. */
	| { kind: 'none' }
	| { kind: 'ok'; user: AuthUser; ctx: RequestContext; token: ApiToken }
	/** Answer with this and stop. Never fall back to another sign-in path. */
	| { kind: 'rejected'; status: number; code: ApiErrorCode; message: string };

export interface ResolveApiTokenDeps {
	/** Absent when the host hasn't configured API tokens: a sent key gets 503. */
	codec?: ApiTokenCodec;
	auth: Pick<IAuthProvider, 'getUser'>;
	data: Pick<IDataProvider, 'apiTokens' | 'orgs'>;
	/** Receives background failures (the `lastUsedAt` write). Logs the token id only. */
	log?: ILogger;
	now?: () => number;
}

export interface ResolveApiTokenOptions {
	/** Keys work under this prefix and are refused everywhere else. */
	pathPrefix?: string;
}

/** `lastUsedAt` is written at most this often per token, so a busy key isn't a write per request. */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const UNAUTHORIZED: ApiTokenResolution = {
	kind: 'rejected',
	status: 401,
	code: ApiErrorCode.UNAUTHORIZED,
	message: 'This API token is invalid, expired or revoked.'
};

/**
 * Authenticate a request by its `Authorization: Bearer selva_…` header.
 *
 * Call it before any cookie or proxy sign-in. Once a `selva_` key is sent the
 * outcome is final: a bad key gets 401 even if a valid session cookie rides
 * along, because running the request as the cookie's user would hide the
 * broken key and act as someone else.
 *
 * The owner is re-checked on every request (disabled, still a member of the
 * token's org), then their live context is narrowed to the token's scopes.
 */
export async function resolveApiToken(
	request: Request,
	deps: ResolveApiTokenDeps,
	{ pathPrefix = '/api/v1/' }: ResolveApiTokenOptions = {}
): Promise<ApiTokenResolution> {
	const url = new URL(request.url);
	for (const value of url.searchParams.values()) {
		if (looksLikeApiToken(value)) {
			return {
				kind: 'rejected',
				status: 400,
				code: ApiErrorCode.VALIDATION_FAILED,
				message:
					'API tokens go in the Authorization header, never the URL. URLs end up in logs and browser history; revoke this key.'
			};
		}
	}

	const raw = bearerOf(request);
	if (!raw?.startsWith(API_TOKEN_PREFIX)) return { kind: 'none' };

	if (!url.pathname.startsWith(pathPrefix)) {
		return {
			kind: 'rejected',
			status: 403,
			code: ApiErrorCode.FORBIDDEN,
			message: `API tokens only work under ${pathPrefix}.`
		};
	}

	const store = deps.data.apiTokens;
	if (!deps.codec || !store) {
		return {
			kind: 'rejected',
			status: 503,
			code: ApiErrorCode.API_TOKENS_UNAVAILABLE,
			message: 'API tokens are not available on this server.'
		};
	}

	if (!deps.codec.hasValidChecksum(raw)) return UNAUTHORIZED;
	const token = await store.getByTokenHash(SYSTEM_CONTEXT, deps.codec.hashToken(raw));
	if (!token) return UNAUTHORIZED;

	const [user, member] = await Promise.all([
		deps.auth.getUser(token.userId),
		deps.data.orgs.getOrgMember(SYSTEM_CONTEXT, token.orgId, token.userId)
	]);
	if (!user || user.disabled || !member) return UNAUTHORIZED;

	// Platform permissions aren't read: narrowing drops them anyway.
	const ctx = narrowApiTokenContext(
		await buildRequestContext(
			{ user, platformPermissions: [], membership: member, pinOrg: true },
			{ orgs: deps.data.orgs }
		),
		token
	);

	const now = deps.now?.() ?? Date.now();
	if (!token.lastUsedAt || now - Date.parse(token.lastUsedAt) >= LAST_USED_WRITE_INTERVAL_MS) {
		store.touchLastUsed(SYSTEM_CONTEXT, token.id, new Date(now).toISOString()).catch((err) => {
			deps.log?.warn('Failed to record API token use', {
				component: 'apiToken',
				tokenId: token.id,
				err: err instanceof Error ? err.message : String(err)
			});
		});
	}

	return { kind: 'ok', user, ctx, token };
}

function bearerOf(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
	return match ? match[1]! : null;
}
