import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { Project, ProjectMember } from './types.js';
import type { ProjectRole } from './schemas.js';

/**
 * Projects + project members. Soft-delete cascades to members and definitions;
 * see also the cross-store cascade hook on `IPlatformProjectGrantStore`.
 */
export interface IProjectStore {
	// Projects
	listProjects(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Project>>;
	getProject(ctx: RequestContext, id: string): Promise<Project | null>;
	getProjectBySlug(ctx: RequestContext, orgId: string, slug: string): Promise<Project | null>;
	createProject(ctx: RequestContext, project: Project): Promise<void>;
	updateProject(
		ctx: RequestContext,
		id: string,
		patch: Partial<
			Pick<Project, 'name' | 'slug' | 'description' | 'visibility' | 'autoJoinOnUpload'>
		>
	): Promise<void>;
	/** Soft-delete. Cascades to project members and definitions (and, through the definition delete, to definition versions and share links). */
	deleteProject(ctx: RequestContext, id: string): Promise<void>;
	/**
	 * Reactivates a soft-deleted project by org + slug: clears `deleted_at`
	 * and reactivates the owner's `project_members` row. Returns `null` if no
	 * tombstone with that slug exists.
	 *
	 * Use this when `createProject` hits a duplicate-key error on a
	 * soft-deleted slug — the unique constraint isn't conditional, so it
	 * blocks creation even though `getProjectBySlug` returns null for tombstones.
	 */
	reactivateProject(ctx: RequestContext, orgId: string, slug: string): Promise<Project | null>;

	// Project members
	listProjectMembers(
		ctx: RequestContext,
		projectId: string,
		opts?: ListOptions
	): Promise<Page<ProjectMember>>;
	getProjectMember(
		ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<ProjectMember | null>;
	/**
	 * One user's membership row across many projects, in a single query —
	 * avoids one round-trip per project when evaluating `canView` over a list.
	 * Keys are the requested `projectIds`; a project the user isn't a member of
	 * maps to `null` rather than being absent, distinguishing "checked, not a
	 * member" from "never asked".
	 */
	getProjectMembersFor(
		ctx: RequestContext,
		projectIds: readonly string[],
		userId: string
	): Promise<Map<string, ProjectMember | null>>;
	addProjectMember(ctx: RequestContext, member: ProjectMember): Promise<void>;
	updateProjectMemberRole(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		role: ProjectRole
	): Promise<void>;
	removeProjectMember(ctx: RequestContext, projectId: string, userId: string): Promise<void>;
}
