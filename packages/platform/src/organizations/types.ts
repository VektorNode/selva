import type { OrgRole, OrgPermission, OrgAssetKind } from './schemas.js';

/**
 * Public URLs of an org's branding assets, keyed by kind. Each value is what
 * `IStorageProvider.getPublicUrl` returned for the stored blob; a kind is
 * absent when unset. One small map so adding a new asset kind never touches
 * the `Organization` shape, the migration, or the row mappers again.
 */
export type OrgAssets = Partial<Record<OrgAssetKind, string>>;

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
	/** Branding assets (logo, favicon, …) by kind. Blobs live under `orgPaths.asset()`. */
	assets?: OrgAssets;
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
