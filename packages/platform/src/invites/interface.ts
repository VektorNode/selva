import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { Invite } from './types.js';

/**
 * "Admin invites a user, user clicks link and joins" flow. Decoupled from
 * `IAuthProvider` so accept works regardless of how credentials are owned.
 *
 * Mutations require a session (gated by route layer). `getByToken` and
 * `markAccepted` accept `SYSTEM_CONTEXT` because the token is the capability
 * — the public /accept-invite page has no session yet.
 */
export interface IInviteStore {
	create(ctx: RequestContext, invite: Invite): Promise<void>;

	/** Returns null for unknown, expired, or consumed invites. */
	getByToken(ctx: RequestContext, token: string): Promise<Invite | null>;

	listByOrg(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Invite>>;

	/** No-op if already accepted. */
	markAccepted(ctx: RequestContext, id: string, userId: string): Promise<void>;

	/** No-op if already consumed or missing. */
	revoke(ctx: RequestContext, id: string): Promise<void>;

	/**
	 * Hard-delete every invite belonging to an org. Called from `deleteOrg`
	 * cascade — pending invites to a deleted org are unredeemable, so leaving
	 * them behind only creates orphans.
	 */
	deleteByOrg(ctx: RequestContext, orgId: string): Promise<void>;
}
