import type {
	IProjectStore,
	IEventSink,
	Project,
	ProjectMember,
	ProjectRole,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import { ProviderError, auditSoftDelete, actorFrom, NoopEventSink } from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { nextCursorFromRange, orderColumn, toRange } from './pagination.js';

/**
 * Project + project-membership store backed by Postgres. Visibility semantics
 * (public / org / private) are enforced by the `visible_project()` helper in
 * RLS. Access predicates (canEdit / canManage / canView etc.) live as pure
 * functions in `@selvajs/platform/access`; the route layer composes them with
 * pre-loaded entities. See `compute-app/src/lib/server/access.server.ts`.
 *
 * `createProject` atomically seeds the creator as the project `owner` in
 * `project_members` so subsequent user-scoped reads can see it.
 */
export class SupabaseProjectStore implements IProjectStore {
	private readonly events: IEventSink;

	constructor(
		private readonly clients: ClientBundle,
		events: IEventSink = new NoopEventSink()
	) {
		this.events = events;
	}

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
			.is('deleted_at', null)
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
			.is('deleted_at', null)
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
			.is('deleted_at', null)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToProject(data) : null;
	}

	async createProject(ctx: RequestContext, project: Project): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const { error } = await client.from('projects').insert(projectToRow(project));
		if (error) throw mapError(error);

		// Seed owner membership so user-scoped reads see the project post-create.
		// Upsert so a stale soft-deleted row from a prior project with the same id
		// is reactivated rather than blocking creation.
		const { error: memberError } = await client.from('project_members').upsert(
			{
				project_id: project.id,
				user_id: project.ownerId,
				role: 'owner',
				joined_at: new Date().toISOString(),
				deleted_at: null
			},
			{ onConflict: 'project_id,user_id' }
		);
		if (memberError) throw mapError(memberError);
		await this.events.emit({
			type: 'project.created',
			projectId: project.id,
			orgId: project.orgId,
			actorId: actorFrom(ctx)
		});
	}

	async updateProject(
		ctx: RequestContext,
		id: string,
		patch: Partial<
			Pick<Project, 'name' | 'slug' | 'description' | 'visibility' | 'autoJoinOnUpload'>
		>
	): Promise<void> {
		const row: Record<string, unknown> = {};
		if (patch.name !== undefined) row.name = patch.name;
		if (patch.slug !== undefined) row.slug = patch.slug;
		if (patch.description !== undefined) row.description = patch.description;
		if (patch.visibility !== undefined) row.visibility = patch.visibility;
		if (patch.autoJoinOnUpload !== undefined) row.auto_join_on_upload = patch.autoJoinOnUpload;
		if (Object.keys(row).length === 0) return;
		if (ctx.userId) row.updated_by = ctx.userId;

		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('projects')
			.update(row)
			.eq('id', id)
			.is('deleted_at', null)
			.select('id');
		if (error) throw mapError(error);
		if (!data || data.length === 0) throw new ProviderError(`Project '${id}' not found`, 404);
	}

	async deleteProject(ctx: RequestContext, id: string): Promise<void> {
		// §9 soft-delete with cascade. Mirrors LocalProjectStore: project →
		// project_members, definitions. FK CASCADE doesn't fire on soft-delete,
		// so the cascade is in app code.
		const client = this.clients.forRequest(ctx);
		const stamp = auditSoftDelete(ctx, ctx.userId);
		const stampRow = stampToRow(stamp);

		const { data, error } = await client
			.from('projects')
			.update(stampRow)
			.eq('id', id)
			.is('deleted_at', null)
			.select('id');
		if (error) throw mapError(error);
		if (!data || data.length === 0) throw new ProviderError(`Project '${id}' not found`, 404);

		const { error: pmErr } = await client
			.from('project_members')
			.update(stampRow)
			.eq('project_id', id)
			.is('deleted_at', null);
		if (pmErr) throw mapError(pmErr);

		const { error: defErr } = await client
			.from('definitions')
			.update(stampRow)
			.eq('project_id', id)
			.is('deleted_at', null);
		if (defErr) throw mapError(defErr);

		await this.events.emit({ type: 'project.deleted', projectId: id, actorId: actorFrom(ctx) });
	}

	// ============================================================================
	// Project members
	// ============================================================================
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
			.is('deleted_at', null)
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
			.is('deleted_at', null)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToProjectMember(data) : null;
	}

	async addProjectMember(ctx: RequestContext, member: ProjectMember): Promise<void> {
		// Upsert reactivates a prior soft-deleted row instead of throwing
		// duplicate-key. Mirrors LocalProjectStore.addProjectMember.
		const row: Record<string, unknown> = {
			...projectMemberToRow(member),
			deleted_at: null
		};
		if (ctx.userId) row.updated_by = ctx.userId;
		const { error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.upsert(row, { onConflict: 'project_id,user_id' });
		if (error) throw mapError(error);
		await this.events.emit({
			type: 'project_member.added',
			projectId: member.projectId,
			userId: member.userId,
			actorId: actorFrom(ctx)
		});
	}

	async updateProjectMemberRole(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		role: ProjectRole
	): Promise<void> {
		const row: Record<string, unknown> = { role };
		if (ctx.userId) row.updated_by = ctx.userId;
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.update(row)
			.eq('project_id', projectId)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.select('user_id');
		if (error) throw mapError(error);
		if (!data || data.length === 0)
			throw new ProviderError(`Project member '${userId}' not found`, 404);
		await this.events.emit({
			type: 'project_member.role_changed',
			projectId,
			userId,
			role,
			actorId: actorFrom(ctx)
		});
	}

	async removeProjectMember(ctx: RequestContext, projectId: string, userId: string): Promise<void> {
		const stamp = auditSoftDelete(ctx, ctx.userId);
		const { error } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.update(stampToRow(stamp))
			.eq('project_id', projectId)
			.eq('user_id', userId)
			.is('deleted_at', null);
		if (error) throw mapError(error);
		await this.events.emit({
			type: 'project_member.removed',
			projectId,
			userId,
			actorId: actorFrom(ctx)
		});
	}
}

// ============================================================================
// Row ↔ domain mappers
// ============================================================================
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

// ============================================================================
// Error translation
// ============================================================================
interface PostgrestError {
	code?: string;
	message?: string;
}

/**
 * Build a row payload from an audit-soft-delete stamp. `updated_by` only goes
 * into the row when ctx.userId is set — passing `''` would violate the
 * `references auth.users(id)` FK on system contexts. The DB trigger sets
 * `updated_at`, but for soft-delete we set it explicitly so it matches
 * `deleted_at` (single timestamp for the deletion event).
 */
function stampToRow(stamp: {
	updatedAt: string;
	updatedBy: string;
	deletedAt: string;
}): Record<string, unknown> {
	const row: Record<string, unknown> = {
		deleted_at: stamp.deletedAt,
		updated_at: stamp.updatedAt
	};
	if (stamp.updatedBy) row.updated_by = stamp.updatedBy;
	return row;
}

function mapError(e: unknown): Error {
	const pg = e as PostgrestError;
	if (pg?.code === '23505') return new ProviderError(pg.message ?? 'Duplicate record', 409);
	if (pg?.code === '23503') return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	if (e instanceof Error) return e;
	if (e && typeof e === 'object') {
		const obj = e as { message?: string; details?: string; hint?: string; code?: string };
		const msg = obj.message ?? obj.details ?? obj.hint ?? 'Unknown Postgres error';
		const err = new Error(obj.code ? `[${obj.code}] ${msg}` : msg);
		Object.assign(err, obj);
		return err;
	}
	return new Error(String(e));
}
