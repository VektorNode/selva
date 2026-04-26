import type { OrgRole, OrgPermission } from '../organizations/schemas.js';

/**
 * "The holder of `token` may join `orgId` at `orgRole` with these org
 * permissions." Accepting creates the user (if needed), the org membership,
 * and marks the invite consumed.
 *
 * The `token` is the shared secret embedded in the accept URL — knowing it
 * is the auth, so `getByToken` is callable without a session.
 */
export interface Invite {
	id: string;
	/** URL-safe random string. Shown only in the accept link. */
	token: string;
	/** Lowercase email the invite was issued for. */
	email: string;
	orgId: string;
	orgRole: OrgRole;
	/**
	 * Permissions to grant on accept. May be empty — adapters may seed from
	 * `DEFAULT_ORG_PERMISSIONS` in that case.
	 */
	orgPermissions: OrgPermission[];
	invitedBy: string;
	createdAt: string;
	expiresAt: string;
	/** Set when consumed. Consumed invites are not re-usable. */
	acceptedAt?: string;
	acceptedByUserId?: string;
}
