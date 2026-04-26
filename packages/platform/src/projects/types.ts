import type { ProjectRole, ProjectVisibility } from './schemas.js';

/**
 * Visibility:
 * - `public`  — any authenticated user can view/solve
 * - `org`     — any member of the parent organization
 * - `private` — only listed `ProjectMember`s
 */
export interface Project {
	id: string;
	orgId: string;
	name: string;
	slug: string;
	description?: string;
	visibility: ProjectVisibility;
	/** Transferable; distinct from `createdBy`. */
	ownerId: string;
	createdBy: string;
	updatedBy: string;
	/** Commons mode — only valid when `visibility='public'`. */
	autoJoinOnUpload: boolean;
	createdAt: string;
	updatedAt: string;
	deletedAt?: string | null;
}

export interface ProjectMember {
	projectId: string;
	userId: string;
	role: ProjectRole;
	joinedAt: string;
	updatedAt: string;
	updatedBy: string;
	deletedAt?: string | null;
}
