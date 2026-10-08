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
import type { ApiTokenHolderPolicy } from '../tokens/api-token-holder.js';
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
	auth: Pick<IAuthProvider, 'getUser' | 'delegatedSession'>;
	/** `permissions` is read only for `mayHoldApiTokens`; without it the policy sees no platform permissions. */
	data: Pick<IDataProvider, 'apiTokens' | 'orgs'> & Partial<Pick<IDataProvider, 'permissions'>>;
	/** The same policy passed as `SelvaDeps.tokens.mayHoldApiTokens`. Absent: keys aren't re-checked against one. */
	mayHoldApiTokens?: ApiTokenHolderPolicy;
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

const UNAVAILABLE: ApiTokenResolution = {
	kind: 'rejected',
	status: 503,
	code: ApiErrorCode.API_TOKENS_UNAVAILABLE,
	message: 'API tokens are not available on this server.'
};

const HOLDER_REFUSED: ApiTokenResolution = {
	kind: 'rejected',
	status: 403,
	code: ApiErrorCode.API_TOKEN_HOLDER_REFUSED,
	message: 'This API token’s owner may no longer use API tokens in this org.'
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
 * token's org, and the host's holder policy if any), then their live context
 * is narrowed to the token's scopes.
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
	if (!deps.codec || !store) return UNAVAILABLE;

	// The provider logs why; the admin health page shows it.
	const delegated = deps.auth.delegatedSession;
	if (delegated && !(await delegated.status()).ok) return UNAVAILABLE;

	if (!deps.codec.hasValidChecksum(raw)) return UNAUTHORIZED;
	const token = await store.getByTokenHash(SYSTEM_CONTEXT, deps.codec.hashToken(raw));
	if (!token) return UNAUTHORIZED;

	const policy = deps.mayHoldApiTokens;
	const [user, member, platformPermissions] = await Promise.all([
		deps.auth.getUser(token.userId),
		deps.data.orgs.getOrgMember(SYSTEM_CONTEXT, token.orgId, token.userId),
		// Read only for the policy: narrowing drops platform permissions anyway.
		policy && deps.data.permissions
			? deps.data.permissions.getFor(SYSTEM_CONTEXT, token.userId)
			: []
	]);
	if (!user || user.disabled || !member) return UNAUTHORIZED;

	const live = await buildRequestContext(
		{ user, platformPermissions, membership: member, pinOrg: true },
		{ orgs: deps.data.orgs }
	);
	if (policy && !policy(live)) return HOLDER_REFUSED;
	let ctx = narrowApiTokenContext(live, token);

	// Signed only after the user check above: a minted session can't be
	// revoked, and row security doesn't look at bans.
	if (delegated) {
		const sessionToken = await delegated.mint(user.id, { orgId: token.orgId });
		ctx = { ...ctx, adapterContext: { sessionToken } };
	}

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
