/**
 * Organization and Project provider interfaces.
 *
 * Models a three-level ownership hierarchy:
 *   Platform → Organization → Project → Definition
 *
 * Implement for any backend:
 * - Local JSON files (built-in default)
 * - Supabase (row-level security tables)
 * - Firebase Firestore
 * - Any relational database
 */

// ── Organization ──────────────────────────────────────────────────────────────

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

// ── Project ───────────────────────────────────────────────────────────────────

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

// ── Provider interface ────────────────────────────────────────────────────────

export interface IOrganizationProvider {
	// ── Organizations ─────────────────────────────────────────────────────────

	listOrgs(): Promise<Organization[]>;
	getOrg(id: string): Promise<Organization | null>;
	getOrgBySlug(slug: string): Promise<Organization | null>;
	createOrg(org: Organization): Promise<void>;
	/** Patch mutable org fields. Only name and slug may be changed after creation. */
	updateOrg(id: string, patch: Partial<Pick<Organization, 'name' | 'slug'>>): Promise<void>;
	/** Delete an org and all its projects (cascade is implementation-specific). */
	deleteOrg(id: string): Promise<void>;

	// ── Org members ───────────────────────────────────────────────────────────

	listOrgMembers(orgId: string): Promise<OrgMember[]>;
	getOrgMember(orgId: string, userId: string): Promise<OrgMember | null>;
	addOrgMember(member: OrgMember): Promise<void>;
	updateOrgMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void>;
	removeOrgMember(orgId: string, userId: string): Promise<void>;

	// ── Projects ──────────────────────────────────────────────────────────────

	listProjects(orgId: string): Promise<Project[]>;
	getProject(id: string): Promise<Project | null>;
	getProjectBySlug(orgId: string, slug: string): Promise<Project | null>;
	createProject(project: Project): Promise<void>;
	updateProject(
		id: string,
		patch: Partial<Pick<Project, 'name' | 'slug' | 'description' | 'visibility'>>
	): Promise<void>;
	deleteProject(id: string): Promise<void>;

	// ── Project members ───────────────────────────────────────────────────────

	listProjectMembers(projectId: string): Promise<ProjectMember[]>;
	getProjectMember(projectId: string, userId: string): Promise<ProjectMember | null>;
	addProjectMember(member: ProjectMember): Promise<void>;
	updateProjectMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<void>;
	removeProjectMember(projectId: string, userId: string): Promise<void>;

	// ── Access checks ─────────────────────────────────────────────────────────
	// Primary authorization enforcement points.
	// Implementations must check visibility, membership, and platform role.

	/** Returns true if the user may invoke solve on any definition in the project. */
	canSolve(userId: string, projectId: string): Promise<boolean>;

	/** Returns true if the user may upload or modify definitions in the project. */
	canEdit(userId: string, projectId: string): Promise<boolean>;

	/** Returns true if the user may manage project members and settings. */
	canManage(userId: string, projectId: string): Promise<boolean>;
}
