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

/**
 * Who can invoke solve on definitions in this project:
 * - 'public'  — any authenticated user
 * - 'org'     — any member of the parent organization
 * - 'private' — only users listed in ProjectMember
 */
export type ProjectVisibility = 'public' | 'org' | 'private';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export interface Project {
	/** UUID v4 primary key */
	id: string;
	/** UUID of the owning organization */
	orgId: string;
	name: string;
	/** URL-safe, unique within the organization */
	slug: string;
	description?: string;
	visibility: ProjectVisibility;
	/** UUID of the user who created this project */
	ownerId: string;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

export interface ProjectMember {
	projectId: string;
	userId: string;
	role: ProjectRole;
	joinedAt: string; // ISO 8601
}
