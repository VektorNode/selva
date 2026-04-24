import type { ProjectRole, ProjectVisibility } from './schemas.js';

/**
 * `ProjectVisibility` and `ProjectRole` live in `./schemas.js` so the Zod
 * enum is the single source of truth. Re-exported from `./index.js`.
 *
 * Visibility:
 * - 'public'  — any authenticated user can solve
 * - 'org'     — any member of the parent organization can solve
 * - 'private' — only users listed in ProjectMember can solve
 */

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
