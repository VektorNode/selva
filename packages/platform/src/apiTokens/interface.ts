import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { ApiToken, ApiTokenRevokeReason, ApiTokenSummary } from './types.js';

/**
 * Mutations are gated by the route layer. `getByTokenHash` and `touchLastUsed`
 * run as `SYSTEM_CONTEXT`: the key is the credential, and there is no session
 * yet when it is resolved.
 */
export interface IApiTokenStore {
	create(ctx: RequestContext, token: ApiToken): Promise<void>;

	/** Live tokens only: unknown, revoked and expired hashes all return null. */
	getByTokenHash(ctx: RequestContext, tokenHash: string): Promise<ApiToken | null>;

	/** Any state, including revoked and expired. */
	get(ctx: RequestContext, id: string): Promise<ApiTokenSummary | null>;

	/** Newest first by default. `userId` narrows to one owner's tokens. */
	listByOrg(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions & { userId?: string }
	): Promise<Page<ApiTokenSummary>>;

	/** No-op if already revoked or missing. */
	revoke(ctx: RequestContext, id: string, reason: ApiTokenRevokeReason): Promise<void>;

	/**
	 * Revoke every live token `userId` owns, in one org or (no `orgId`) all of
	 * them, returning the ids revoked. One call so a token minted between a
	 * list and a per-id revoke can't survive.
	 */
	revokeAllForUser(
		ctx: RequestContext,
		userId: string,
		opts: { orgId?: string; reason: ApiTokenRevokeReason }
	): Promise<string[]>;

	/** Best effort; callers throttle and never await it on the request path. */
	touchLastUsed(ctx: RequestContext, id: string, at: string): Promise<void>;

	/** Erasure: deletes the user's tokens and clears `createdBy` on tokens they minted for others. */
	eraseUser(ctx: RequestContext, userId: string): Promise<void>;

	/** Called from the `deleteOrg` cascade. */
	deleteByOrg(ctx: RequestContext, orgId: string): Promise<void>;
}
