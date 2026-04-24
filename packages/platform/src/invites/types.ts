import type { OrgRole, OrgPermission } from '../organizations/schemas.js';

/**
 * A pre-authorization record: "the holder of `token` may join `orgId`
 * at `orgRole`, with the org `orgPermissions` listed below". Accepting
 * the invite creates the user (if needed), the org membership, and marks
 * the invite consumed.
 *
 * The `token` is the shared secret embedded in the accept URL. Knowing
 * the token is the auth — `getByToken` is callable without a session.
 */
export interface Invite {
	/** UUID — internal primary key, stable across renames. */
	id: string;
	/** URL-safe random string. Shown only in the accept link. */
	token: string;
	/** Lowercase email the invite was issued for. */
	email: string;
	orgId: string;
	orgRole: OrgRole;
	/**
	 * Org-scope permissions to grant on accept, applied to the new
	 * `OrgMember.permissions` row for `orgId`. May be empty (the `orgRole`
	 * alone is often enough; adapters may seed from DEFAULT_ORG_PERMISSIONS
	 * when this is empty).
	 */
	orgPermissions: OrgPermission[];
	/** User ID of the admin who created the invite. */
	invitedBy: string;
	createdAt: string;
	expiresAt: string;
	/** Set when the invite is consumed. Consumed invites are not re-usable. */
	acceptedAt?: string;
	acceptedByUserId?: string;
}
