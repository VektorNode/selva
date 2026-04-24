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
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
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
}
