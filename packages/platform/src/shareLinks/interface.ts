import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { ShareLink } from './types.js';

/**
 * Per-definition tokens granting unauthenticated access to one
 * (definitionId, channel). The store sees only the HMAC hash; the raw token
 * is generated and shown to the minter at the route layer.
 *
 * Reads filter `revokedAt IS NULL` defensively.
 */
export interface IShareLinkStore {
	/** Caller has already hashed the raw token. */
	create(ctx: RequestContext, link: ShareLink): Promise<void>;
	/** Newest first by `createdAt`. Excludes revoked links. */
	listByDefinition(
		ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<ShareLink>>;
	getById(ctx: RequestContext, id: string): Promise<ShareLink | null>;
	/** Returns null when the link doesn't exist, is revoked, or its parent definition is soft-deleted. */
	getByTokenHash(ctx: RequestContext, tokenHash: string): Promise<ShareLink | null>;
	/** Soft-delete (set `revokedAt`). Idempotent. */
	revoke(ctx: RequestContext, id: string): Promise<void>;
	/**
	 * Atomic check-and-increment; must be a single statement, since
	 * read-then-write races under load. Returns the new `solveCount`, or
	 * null when the cap was reached. `null` maxSolves means uncapped.
	 */
	tryIncrementSolveCount(ctx: RequestContext, id: string): Promise<number | null>;
}
