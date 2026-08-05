import type { OrgRole, OrgPermission } from '../organizations/schemas.js';

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
	/**
	 * `HMAC-SHA256(SELVA_HMAC_KEY, rawToken)` — base64url. The raw token
	 * never crosses the store boundary; the route layer hashes inbound tokens
	 * before lookup.
	 */
	tokenHash: string;
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
