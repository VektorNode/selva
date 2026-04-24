import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { Invite } from './types.js';

/**
 * Invite store for the "admin invites a user, user clicks link and joins"
 * flow. Decoupled from `IAuthProvider` so the accept flow works the same
 * regardless of how credentials are owned (local password, Supabase,
 * federated SSO).
 *
 * Auth model:
 * - Mutations (`create`, `listByOrg`, `revoke`) require a session and are
 *   gated by the route layer (manage_org_members + same-org membership).
 * - `getByToken` and `markAccepted` accept `SYSTEM_CONTEXT` because the
 *   token itself is the capability; the public /accept-invite page has no
 *   session yet.
 */
export interface IInviteStore {
	create(ctx: RequestContext, invite: Invite): Promise<void>;

	/** Look up by the shareable token. Returns null for unknown, expired, or consumed invites. */
	getByToken(ctx: RequestContext, token: string): Promise<Invite | null>;

	listByOrg(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Invite>>;

	/** Mark as accepted. No-op if already accepted. */
	markAccepted(ctx: RequestContext, id: string, userId: string): Promise<void>;

	/** Revoke a pending invite. No-op if already consumed or missing. */
	revoke(ctx: RequestContext, id: string): Promise<void>;
}
