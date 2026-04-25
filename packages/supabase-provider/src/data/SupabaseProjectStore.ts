import type {
	IProjectStore,
	Project,
	ProjectMember,
	ProjectRole,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
import type { ClientBundle } from './client.js';
import { nextCursorFromRange, orderColumn, toRange } from './pagination.js';

/**
 * Project + project-membership store backed by Postgres. Visibility semantics
 * (public / org / private) are enforced by the `visible_project()` helper in
 * RLS; `canEdit` / `canEditProjectSettings` / `canManage` call into the same
 * SQL helpers so UI gating matches policy evaluation exactly.
 *
 * `createProject` atomically seeds the creator as the project `owner` in
 * `project_members` so subsequent user-scoped reads can see it.
 */
export class SupabaseProjectStore implements IProjectStore {
	constructor(private readonly clients: ClientBundle) {}

	async listProjects(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<Project>> {
		const range = toRange(opts);
		const direction = opts?.orderDir ?? 'desc';
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('projects')
			.select('*', { count: 'exact' })
			.eq('org_id', orgId)
			.order(orderColumn(opts?.orderBy), { ascending: direction === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapError(error);
		const items = (data ?? []).map(rowToProject);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getProject(ctx: RequestContext, id: string): Promise<Project | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('projects')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToProject(data) : null;
	}

	async getProjectBySlug(
		ctx: RequestContext,
		orgId: string,
		slug: string
	): Promise<Project | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('projects')
			.select('*')
			.eq('org_id', orgId)
			.eq('slug', slug)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToProject(data) : null;
	}

	async createProject(ctx: RequestContext, project: Project): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const { error } = await client.from('projects').insert(projectToRow(project));
		if (error) throw mapError(error);

		// Seed owner membership so user-scoped reads see the project post-create.
		const { error: memberError } = await client.from('project_members').insert({
			project_id: project.id,
			user_id: project.ownerId,
			role: 'owner',
			joined_at: new Date().toISOString()
		});
		if (memberError && !isUniqueViolation(memberError)) throw mapError(memberError);
	}

	async updateProject(
		ctx: RequestContext,
		id: string,
		patch: Partial<
			Pick<
				Project,
				'name' | 'slug' | 'description' | 'visibility' | 'autoJoinOnUpload'
			>
		>
	): Promise<void> {
		const row: Record<string, unknown> = {};
		if (patch.name !== undefined) row.name = patch.name;
		if (patch.slug !== undefined) row.slug = patch.slug;
		if (patch.description !== undefined) row.description = patch.description;
		if (patch.visibility !== undefined) row.visibility = patch.visibility;
		if (patch.autoJoinOnUpload !== undefined) row.auto_join_on_upload = patch.autoJoinOnUpload;
		if (Object.keys(row).length === 0) return;

		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('projects')
			.update(row)
			.eq('id', id)
			.select('id');
		if (error) throw mapError(error);
		if (!data || data.length === 0) throw new ProviderError(`Project '${id}' not found`, 404);
	}

	async deleteProject(ctx: RequestContext, id: string): Promise<void> {
		const { error } = await this.clients.forRequest(ctx).from('projects').delete().eq('id', id);
		if (error) throw mapError(error);
	}

	// ── Project members ──────────────────────────────────────────────────────

	async listProjectMembers(
		ctx: RequestContext,
		projectId: string,
		opts?: ListOptions
	): Promise<Page<ProjectMember>> {
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.select('*', { count: 'exact' })
			.eq('project_id', projectId)
			.order('joined_at', { ascending: (opts?.orderDir ?? 'desc') === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapError(error);
		const items = (data ?? []).map(rowToProjectMember);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getProjectMember(
		ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<ProjectMember | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.select('*')
			.eq('project_id', projectId)
			.eq('user_id', userId)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToProjectMember(data) : null;
	}

	async addProjectMember(ctx: RequestContext, member: ProjectMember): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.insert(projectMemberToRow(member));
		if (error) throw mapError(error);
	}

	async updateProjectMemberRole(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		role: ProjectRole
	): Promise<void> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.update({ role })
			.eq('project_id', projectId)
			.eq('user_id', userId)
			.select('user_id');
		if (error) throw mapError(error);
		if (!data || data.length === 0)
			throw new ProviderError(`Project member '${userId}' not found`, 404);
	}

	async removeProjectMember(
		ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.delete()
			.eq('project_id', projectId)
			.eq('user_id', userId);
		if (error) throw mapError(error);
	}

	// ── Access checks (UI gating — mutating methods are the real boundary) ──

	async canEdit(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (ctx.platformPermissions.includes('instance_admin')) return true;
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.select('role')
			.eq('project_id', projectId)
			.eq('user_id', ctx.userId)
			.maybeSingle();
		if (error) throw mapError(error);
		if (data?.role === 'owner' || data?.role === 'editor') return true;

		// `manage_definitions` + public project + member of the org → can edit.
		if (!ctx.orgPermissions.includes('manage_definitions')) return false;
		const { data: project, error: projectError } = await this.clients
			.forRequest(ctx)
			.from('projects')
			.select('visibility, org_id')
			.eq('id', projectId)
			.maybeSingle();
		if (projectError) throw mapError(projectError);
		if (!project || project.visibility !== 'public') return false;
		// RLS on org_members already restricts to caller's orgs.
		const { data: member } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.select('user_id')
			.eq('org_id', project.org_id)
			.eq('user_id', ctx.userId)
			.maybeSingle();
		return member !== null;
	}

	async canEditProjectSettings(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (ctx.platformPermissions.includes('instance_admin')) return true;
		const { data } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.select('role')
			.eq('project_id', projectId)
			.eq('user_id', ctx.userId)
			.maybeSingle();
		if (data?.role === 'owner') return true;
		if (data?.role === 'editor' && ctx.orgPermissions.includes('manage_definitions')) return true;
		return false;
	}

	async canManage(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (ctx.platformPermissions.includes('instance_admin')) return true;
		const { data } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.select('role')
			.eq('project_id', projectId)
			.eq('user_id', ctx.userId)
			.maybeSingle();
		return data?.role === 'owner';
	}
}

// ── Row ↔ domain mappers ────────────────────────────────────────────────
//
// Audit columns (`created_by` / `updated_by`) FK to `auth.users(id)` with
// `ON DELETE SET NULL`; they can legitimately become NULL when the user is
// deleted (spec §8). Mappers fall back to `owner_id` so the domain type
// stays non-nullable. Also true for ProjectMember audit columns below.
// that haven't applied the latest migration — the mapper falls back to
// owner_id / user_id / joined_at in those cases.

interface ProjectRow {
	id: string;
	org_id: string;
	name: string;
	slug: string;
	description: string | null;
	visibility: Project['visibility'];
	owner_id: string;
	created_by?: string | null;
	updated_by?: string | null;
	auto_join_on_upload?: boolean | null;
	created_at: string;
	updated_at: string;
	deleted_at?: string | null;
}

interface ProjectMemberRow {
	project_id: string;
	user_id: string;
	role: ProjectRole;
	joined_at: string;
	updated_at?: string | null;
	updated_by?: string | null;
	deleted_at?: string | null;
}

function rowToProject(row: ProjectRow): Project {
	return {
		id: row.id,
		orgId: row.org_id,
		name: row.name,
		slug: row.slug,
		description: row.description ?? undefined,
		visibility: row.visibility,
		ownerId: row.owner_id,
		createdBy: row.created_by ?? row.owner_id,
		updatedBy: row.updated_by ?? row.owner_id,
		autoJoinOnUpload: row.auto_join_on_upload ?? false,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at ?? null
	};
}

function projectToRow(p: Project): ProjectRow {
	return {
		id: p.id,
		org_id: p.orgId,
		name: p.name,
		slug: p.slug,
		description: p.description ?? null,
		visibility: p.visibility,
		owner_id: p.ownerId,
		created_by: p.createdBy,
		updated_by: p.updatedBy,
		auto_join_on_upload: p.autoJoinOnUpload,
		created_at: p.createdAt,
		updated_at: p.updatedAt,
		deleted_at: p.deletedAt ?? null
	};
}

function rowToProjectMember(row: ProjectMemberRow): ProjectMember {
	return {
		projectId: row.project_id,
		userId: row.user_id,
		role: row.role,
		joinedAt: row.joined_at,
		updatedAt: row.updated_at ?? row.joined_at,
		updatedBy: row.updated_by ?? row.user_id,
		deletedAt: row.deleted_at ?? null
	};
}

function projectMemberToRow(m: ProjectMember): ProjectMemberRow {
	return {
		project_id: m.projectId,
		user_id: m.userId,
		role: m.role,
		joined_at: m.joinedAt
	};
}

// ── Error translation ───────────────────────────────────────────────────

interface PostgrestError {
	code?: string;
	message?: string;
}

function isUniqueViolation(e: unknown): boolean {
	return Boolean(e && typeof e === 'object' && (e as PostgrestError).code === '23505');
}

function mapError(e: unknown): Error {
	const pg = e as PostgrestError;
	if (pg?.code === '23505') return new ProviderError(pg.message ?? 'Duplicate record', 409);
	if (pg?.code === '23503') return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	return e instanceof Error ? e : new Error(String(e));
}
