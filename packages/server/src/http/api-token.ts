import type {
	ApiToken,
	AuthUser,
	IAuthProvider,
	IDataProvider,
	ILogger,
	RequestContext,
	SelvaFlags
} from '@selvajs/platform';
import { createHash } from 'node:crypto';
import { SYSTEM_CONTEXT, narrowApiTokenContext } from '@selvajs/platform';
import { ApiErrorCode } from '../api/errors.js';
import {
	API_TOKEN_PREFIX,
	looksLikeApiToken,
	type ApiTokenCodec
} from '../tokens/api-token-codec.js';
import { canHoldApiTokens, type ApiTokenHolderPolicy } from '../tokens/api-token-holder.js';
import { findByToken } from '../tokens/token-codec.js';
import { buildRequestContext } from './request-context.js';
import { signInIsStale } from './sign-in-age.js';

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
	data: Pick<
		IDataProvider,
		'apiTokens' | 'orgs' | 'permissions' | 'projects' | 'platformProjectGrants' | 'definitions'
	>;
	/** The same policy passed as `SelvaDeps.tokens.mayHoldApiTokens`. Absent: the default rule in `canHoldApiTokens`. */
	mayHoldApiTokens?: ApiTokenHolderPolicy;
	/**
	 * The host's feature flags, which decide project visibility in the holder
	 * rule's project scan. Absent: every flag off, which only ever refuses more.
	 */
	flag?: (name: keyof SelvaFlags) => boolean;
	/**
	 * Skips the holder check for a token that passed it within the cache's TTL.
	 * Absent: checked on every request.
	 */
	holderVerdicts?: HolderVerdictCache;
	/**
	 * Refuse and revoke a key whose owner hasn't signed in at the identity
	 * provider for this long (see `resolveSignInMaxAgeMs`). Keys never pass the
	 * identity provider, so this is what retires a leaver's keys. Absent: no limit.
	 */
	signInMaxAgeMs?: number;
	/**
	 * Answers a key seen within the cache's TTL without re-reading it or its owner. Absent:
	 * every request reads both. See `createApiTokenResolutionCache` for what it gives up.
	 */
	resolutionCache?: ApiTokenResolutionCache;
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
 * token's org, still allowed to hold keys), then their live context is
 * narrowed to the token's scopes.
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
	const now = deps.now?.() ?? Date.now();
	const cacheKey = deps.resolutionCache ? resolutionCacheKey(raw) : null;
	const cached = cacheKey ? deps.resolutionCache!.get(cacheKey, deps.codec, now) : undefined;
	if (cached) {
		// The cached context carries no session: a delegated one lives only seconds.
		const sessionToken = delegated
			? await delegated.mint(cached.user.id, { orgId: cached.token.orgId })
			: undefined;
		const ctx = sessionToken ? { ...cached.ctx, adapterContext: { sessionToken } } : cached.ctx;
		return { kind: 'ok', user: cached.user, ctx, token: cached.token };
	}

	const token = await findByToken(deps.codec, raw, (h) => store.getByTokenHash(SYSTEM_CONTEXT, h));
	if (!token) return UNAUTHORIZED;

	const [user, member, platformPermissions] = await Promise.all([
		deps.auth.getUser(token.userId),
		deps.data.orgs.getOrgMember(SYSTEM_CONTEXT, token.orgId, token.userId),
		// Read only for the holder check: narrowing drops platform permissions anyway.
		deps.data.permissions.getFor(SYSTEM_CONTEXT, token.userId)
	]);
	if (!user || user.disabled || !member) return UNAUTHORIZED;
	if (signInIsStale(user.lastLoginAt, deps.signInMaxAgeMs, now)) {
		// Revoked, not just refused: a reused UPN or email that moves the same
		// row's lastLoginAt would otherwise bring the key back. The answer matches
		// an invalid key so a leaked one doesn't reveal its owner has been away.
		await store.revoke(SYSTEM_CONTEXT, token.id, 'sign_in_lapsed').catch((err) => {
			deps.log?.warn('Failed to revoke a lapsed API token', {
				component: 'apiToken',
				tokenId: token.id,
				err: err instanceof Error ? err.message : String(err)
			});
		});
		return UNAUTHORIZED;
	}

	const live = await buildRequestContext(
		{ user, platformPermissions, membership: member, pinOrg: true },
		{ orgs: deps.data.orgs }
	);
	// A key must always be able to revoke itself, or a refused holder couldn't
	// sign out. Revoking reaches nothing else.
	const revokingItself =
		request.method === 'DELETE' && url.pathname === `${pathPrefix.replace(/\/$/, '')}/me/token`;
	if (!revokingItself && !deps.holderVerdicts?.passed(token.id, now)) {
		const holds = await canHoldApiTokens(live, token.scopes, {
			policy: deps.mayHoldApiTokens,
			deps: {
				orgs: deps.data.orgs,
				projects: deps.data.projects,
				platformProjectGrants: deps.data.platformProjectGrants,
				definitionMeta: deps.data.definitions,
				flag: deps.flag ?? (() => false)
			}
		});
		if (!holds) return HOLDER_REFUSED;
		deps.holderVerdicts?.remember(token.id, now);
	}
	let ctx = narrowApiTokenContext(live, token);
	// A self-revoke skipped the holder check above, so its verdict must not stand for later requests.
	if (cacheKey && !revokingItself) {
		deps.resolutionCache!.set(cacheKey, { user, ctx, token, codec: deps.codec }, now);
	}

	// Signed only after the user check above: a minted session can't be
	// revoked, and row security doesn't look at bans.
	if (delegated) {
		const sessionToken = await delegated.mint(user.id, { orgId: token.orgId });
		ctx = { ...ctx, adapterContext: { sessionToken } };
	}

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

// ============================================================================
// Resolution cache
// ============================================================================

interface CachedResolution {
	user: AuthUser;
	/** Narrowed, without `adapterContext`: a delegated session is minted per request. */
	ctx: RequestContext;
	token: ApiToken;
	/** The codec that found it: a rotated secret ends every key it hashed. */
	codec: ApiTokenCodec;
}

/**
 * Remembers a resolved key for `ttlMs`, so a busy key (an agent's tool calls, a
 * host calling itself in-process) costs its store and owner reads once per
 * window. Within the window a change elsewhere is not seen: a revoke on another
 * instance, an owner disabled or removed from the org, a withdrawn holder right.
 * A revoke through this instance's handlers calls `forget` at once. An expired
 * key is never answered.
 */
export interface ApiTokenResolutionCache {
	get(key: string, codec: ApiTokenCodec, now: number): CachedResolution | undefined;
	set(key: string, value: CachedResolution, now: number): void;
	/** Drops one key, by its id: what a revoke knows. */
	forget(tokenId: string): void;
	/** Drops every key `userId` holds: a leave, a disable, a revoke of them all. */
	forgetUser(userId: string): void;
}

/** The cache key: a digest of the raw key, so the raw key is never held as a map key. */
function resolutionCacheKey(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}

export function createApiTokenResolutionCache(
	ttlMs = 60_000,
	maxEntries = 10_000
): ApiTokenResolutionCache {
	const entries = new Map<string, { value: CachedResolution; until: number }>();
	const drop = (match: (value: CachedResolution) => boolean) => {
		for (const [key, entry] of entries) if (match(entry.value)) entries.delete(key);
	};
	return {
		get(key, codec, now) {
			const entry = entries.get(key);
			if (!entry) return undefined;
			if (entry.until <= now || entry.value.codec !== codec) {
				entries.delete(key);
				return undefined;
			}
			return entry.value;
		},
		set(key, value, now) {
			const expires = Date.parse(value.token.expiresAt);
			const until = Math.min(now + ttlMs, Number.isNaN(expires) ? now + ttlMs : expires);
			if (until <= now) return;
			if (entries.size >= maxEntries) {
				for (const [k, e] of entries) if (e.until <= now) entries.delete(k);
				// Still full of live entries: drop the oldest insert.
				if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
			}
			entries.delete(key);
			entries.set(key, { value, until });
		},
		forget(tokenId) {
			drop((value) => value.token.id === tokenId);
		},
		forgetUser(userId) {
			drop((value) => value.token.userId === userId);
		}
	};
}

export interface HolderVerdictCache {
	passed(tokenId: string, now: number): boolean;
	remember(tokenId: string, now: number): void;
}

/**
 * Remembers passed holder checks for `ttlMs`, so a busy upload key doesn't
 * re-scan its org's projects on every request. A withdrawn right takes effect
 * within the TTL; a disabled owner or a removed member is still refused at once.
 */
export function createHolderVerdictCache(ttlMs = 30_000, maxEntries = 10_000): HolderVerdictCache {
	const until = new Map<string, number>();
	return {
		passed(tokenId, now) {
			const expiry = until.get(tokenId);
			if (expiry === undefined) return false;
			if (expiry > now) return true;
			until.delete(tokenId);
			return false;
		},
		remember(tokenId, now) {
			if (until.size >= maxEntries) {
				for (const [id, expiry] of until) if (expiry <= now) until.delete(id);
				// Still full of live entries: drop the oldest insert.
				if (until.size >= maxEntries) until.delete(until.keys().next().value!);
			}
			until.delete(tokenId);
			until.set(tokenId, now + ttlMs);
		}
	};
}

/** The bearer credential, or null. CSRF's exemption reads it here too: the two must agree. */
export function bearerOf(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
	return match ? match[1]! : null;
}
