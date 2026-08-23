import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { Invite } from './types.js';

/**
 * "Admin invites a user, user clicks link and joins" flow. Decoupled from
 * `IAuthProvider` so accept works regardless of how credentials are owned.
 *
 * Mutations require a session (gated by route layer). `getByTokenHash` and
 * `markAccepted` accept `SYSTEM_CONTEXT` because the token is the capability
 * — the public /accept-invite page has no session yet.
 */
export interface IInviteStore {
	create(ctx: RequestContext, invite: Invite): Promise<void>;

	/**
	 * Caller hashes the inbound raw token and passes the digest here. Returns
	 * null for unknown, expired, or consumed invites.
	 */
	getByTokenHash(ctx: RequestContext, tokenHash: string): Promise<Invite | null>;

	listByOrg(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Invite>>;

	/** No-op if already accepted. */
	markAccepted(ctx: RequestContext, id: string, userId: string): Promise<void>;

	/** No-op if already consumed or missing. */
	revoke(ctx: RequestContext, id: string): Promise<void>;

	/**
	 * Revoke every pending invite to `email` in this org, returning the ids
	 * revoked. Accepted invites are left alone — consuming one is history, not
	 * a live grant.
	 *
	 * Offboarding needs this: `removeOrgMember` cascades `project_members` but
	 * has never touched invites, so a dormant invite let a removed user walk
	 * back in at their original role for the rest of its TTL. Matching by email
	 * rather than user id is deliberate — an invite names an address, and the
	 * account it will create may not exist yet.
	 *
	 * One call rather than list-then-revoke-each: the loop would race a
	 * concurrent accept between the two round-trips.
	 */
	revokePendingByEmail(ctx: RequestContext, orgId: string, email: string): Promise<string[]>;

	/** Called from the `deleteOrg` cascade — invites to a deleted org are unredeemable orphans otherwise. */
	deleteByOrg(ctx: RequestContext, orgId: string): Promise<void>;
}
