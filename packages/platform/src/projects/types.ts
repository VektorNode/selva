import type { ProjectRole, ProjectVisibility } from './schemas.js';

/**
 * Visibility:
 * - 'public'  — any authenticated user can view/solve
 * - 'org'     — any member of the parent organization can view/solve
 * - 'private' — only listed ProjectMembers
 */
export interface Project {
	id: string;
	orgId: string;
	name: string;
	slug: string;
	description?: string;
	visibility: ProjectVisibility;
	/** Current owner. Transferable; distinct from `createdBy`. */
	ownerId: string;
	/** Immutable even on ownership transfer. */
	createdBy: string;
	updatedBy: string;
	/** Commons mode — only valid when visibility='public'. */
	autoJoinOnUpload: boolean;
	/** Anonymous iframe access — only valid when visibility='public'. */
	allowAnonymous: boolean;
	createdAt: string;
	updatedAt: string;
	/** Null = live. Reads filter non-null at the data-access layer. */
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
