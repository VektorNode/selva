import type { OrgRole, OrgPermission } from '../organizations/schemas.js';
import type { PlatformPermission } from '../permissions/types.js';

/**
 * "The holder of the raw token whose hash is `tokenHash` may join `orgId` at
 * `orgRole` with these org permissions." Accepting creates the user (if
 * needed), the org membership, and marks the invite consumed.
 *
 * The raw token is shown to the admin once at mint time and embedded in the
 * accept URL; the store sees only `HMAC-SHA256(secret, rawToken)`. A DB-only
 * leak therefore can't be replayed — the attacker would need the instance
 * secret too. Mirrors the share-link design (`ShareLink.tokenHash`).
 *
 * `getByTokenHash` is callable without a session — knowing a valid token
 * (and therefore being able to hash it) is the auth.
 */
export interface Invite {
	id: string;
	/** `HMAC-SHA256(SELVA_HMAC_KEY, rawToken)`, base64url. The raw token never crosses the store boundary. */
	tokenHash: string;
	/** Lowercase. */
	email: string;
	orgId: string;
	orgRole: OrgRole;
	/** May be empty — adapters may seed from `DEFAULT_ORG_PERMISSIONS` in that case. */
	orgPermissions: OrgPermission[];
	/**
	 * Instance-wide permissions granted on accept — usually empty.
	 *
	 * Only a caller who already holds `instance_admin` may mint an invite
	 * carrying these; the mint route enforces that, because anyone able to set
	 * this field can hand out `instance_admin` and escalate past org scope.
	 * Optional so invites stored before this field existed still parse.
	 */
	platformPermissions?: PlatformPermission[];
	invitedBy: string;
	createdAt: string;
	expiresAt: string;
	/** Set when consumed; consumed invites are not re-usable. */
	acceptedAt?: string;
	acceptedByUserId?: string;
}
