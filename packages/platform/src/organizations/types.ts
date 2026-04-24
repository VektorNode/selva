import type { OrgRole, OrgPermission } from './schemas.js';

export interface Organization {
	/** UUID v4 primary key */
	id: string;
	/** Human-readable display name */
	name: string;
	/** URL-safe unique identifier, e.g. "acme-corp" */
	slug: string;
	/** UUID of the user who owns this org */
	ownerId: string;
	/** UUID of the user who created this org. Immutable. */
	createdBy: string;
	/** UUID of the user who last mutated this org. */
	updatedBy: string;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
	/**
	 * ISO 8601 soft-delete timestamp. Null means live. All reads filter out
	 * non-null at the data-access layer — application code never sees them.
	 * Hard deletion is a retention-window sweep, not an application concern.
	 */
	deletedAt?: string | null;
}

export interface OrgMember {
	orgId: string;
	userId: string;
	role: OrgRole;
	/**
	 * Fine-grained permissions for this user in this org. The `role` is the
	 * user-facing summary; `permissions` is what adapters check. Adapters
	 * seed these from `DEFAULT_ORG_PERMISSIONS[role]` when a member is
	 * added without an explicit list.
	 */
	permissions: OrgPermission[];
	joinedAt: string; // ISO 8601
	/** ISO 8601 timestamp of the last role/permission change. */
	updatedAt: string;
	/** UUID of the user who last changed this membership. */
	updatedBy: string;
	/** Soft-delete — see Organization.deletedAt. */
	deletedAt?: string | null;
}
