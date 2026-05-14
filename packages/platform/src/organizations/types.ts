import type { OrgRole, OrgPermission } from './schemas.js';

export interface Organization {
	id: string;
	name: string;
	/** URL-safe unique identifier, e.g. "acme-corp". */
	slug: string;
	/** Transferable; distinct from `createdBy`. */
	ownerId: string;
	/** Immutable even on ownership transfer. */
	createdBy: string;
	updatedBy: string;
	createdAt: string;
	updatedAt: string;
	deletedAt?: string | null;
}

export interface OrgMember {
	orgId: string;
	userId: string;
	role: OrgRole;
	/**
	 * `role` is the user-facing summary; `permissions` is what adapters check.
	 * Seeded from `DEFAULT_ORG_PERMISSIONS[role]` when not specified.
	 */
	permissions: OrgPermission[];
	joinedAt: string;
	updatedAt: string;
	updatedBy: string;
	deletedAt?: string | null;
}
