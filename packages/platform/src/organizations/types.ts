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

export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrgMember {
	orgId: string;
	userId: string;
	role: OrgRole;
	joinedAt: string; // ISO 8601
}
