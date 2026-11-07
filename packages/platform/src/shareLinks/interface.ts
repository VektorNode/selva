import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { OrgShareLink, ShareLink } from './types.js';

/**
 * Per-definition tokens granting unauthenticated access to one
 * (definitionId, channel). The store sees only the HMAC hash; the raw token
 * is generated and shown to the minter at the route layer.
 *
 * List and token reads treat a revoked or expired link as gone. `getById` does
 * not, so a caller can tell a dead link from a missing one.
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
	/**
	 * Every live link across every definition in the org, newest first.
	 *
	 * A share link is a bearer credential: the URL is the whole authentication.
	 * Listing by definition — the only other read — means "what reaches my org's
	 * data right now?" can only be answered by walking every definition by hand,
	 * so in practice it goes unanswered. Offboarding depends on this being one
	 * query.
	 *
	 * Rows carry the definition and project they hang off, because a roster of
	 * bare GUIDs is not something anyone can act on.
	 */
	listByOrg(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<OrgShareLink>>;
	getById(ctx: RequestContext, id: string): Promise<ShareLink | null>;
	/** Returns null when the link doesn't exist, is revoked, or its parent definition is soft-deleted. */
	getByTokenHash(ctx: RequestContext, tokenHash: string): Promise<ShareLink | null>;
	/**
	 * Soft-delete (set `revokedAt`). Idempotent: emits once, and a repeat is a no-op.
	 * Throws `ProviderError` 404 for an unknown id, and when the caller may not revoke it.
	 */
	revoke(ctx: RequestContext, id: string): Promise<void>;
	/**
	 * Atomic check-and-increment; must be a single statement, since
	 * read-then-write races under load. Returns the new `solveCount`, or null
	 * when the cap was reached or `getByTokenHash` would hide the link.
	 * `null` maxSolves means uncapped.
	 */
	tryIncrementSolveCount(ctx: RequestContext, id: string): Promise<number | null>;
}
