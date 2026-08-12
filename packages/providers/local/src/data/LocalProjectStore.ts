import type {
	IProjectStore,
	IPlatformProjectGrantStore,
	IDefinitionStore,
	IEventSink,
	Project,
	ProjectRole,
	ProjectMember,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import {
	ProviderError,
	auditUpdate,
	auditSoftDelete,
	actorFrom,
	NoopEventSink
} from '@selvajs/platform';
import { paginate, applyOrder } from './pagination.js';
import type { LocalOrgStoreLoader } from './LocalOrgStore.js';

/** Data-access-layer filter — never let a soft-deleted row surface to callers. */
function isLive<T extends { deletedAt?: string | null }>(row: T): boolean {
	return row.deletedAt == null;
}

export interface LocalProjectStoreOptions {
	loader: LocalOrgStoreLoader;
	/**
	 * Sibling store for the `deleteProject` cascade — grants live in a separate
	 * JSON file the loader can't reach. Required, not optional: an unwired
	 * cascade leaks grants on platform projects after deletion.
	 */
	grants: IPlatformProjectGrantStore;
	events?: IEventSink;
}

export class LocalProjectStore implements IProjectStore {
	private readonly loader: LocalOrgStoreLoader;
	private readonly events: IEventSink;
	private readonly grants: IPlatformProjectGrantStore;
	private definitions?: IDefinitionStore;

	constructor(opts: LocalProjectStoreOptions) {
		this.loader = opts.loader;
		this.grants = opts.grants;
		this.events = opts.events ?? new NoopEventSink();
	}

	/**
	 * Wires the definition store for the `deleteProject` cascade. A setter, not
	 * a constructor param, because the composition root builds this store
	 * before the definition store (whose `setProjectProvider` depends on this
	 * one). Unwired, deleted projects keep leaking their definitions into the
	 * library/public listings.
	 */
	setDefinitionProvider(definitions: IDefinitionStore): void {
		this.definitions = definitions;
	}

	async listProjects(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<Project>> {
		const { projects } = await this.loader.get();
		return paginate(
			applyOrder(
				projects.filter((p) => p.orgId === orgId && isLive(p)),
				opts
			),
			opts
		);
	}

	async getProject(_ctx: RequestContext, id: string): Promise<Project | null> {
		const { projects } = await this.loader.get();
		const p = projects.find((p) => p.id === id);
		return p && isLive(p) ? p : null;
	}

	async getProjectBySlug(
		_ctx: RequestContext,
		orgId: string,
		slug: string
	): Promise<Project | null> {
		const { projects } = await this.loader.get();
		const p = projects.find((p) => p.orgId === orgId && p.slug === slug);
		return p && isLive(p) ? p : null;
	}

	async createProject(ctx: RequestContext, project: Project): Promise<void> {
		const store = await this.loader.get();
		if (!store.orgs.some((o) => o.id === project.orgId && isLive(o))) {
			throw new ProviderError(`Org '${project.orgId}' not found`, 404);
		}
		if (store.projects.some((p) => p.id === project.id && isLive(p))) {
			throw new ProviderError(`Project '${project.id}' already exists`, 409);
		}
		const nameKey = project.name.toLowerCase();
		if (
			store.projects.some(
				(p) => p.orgId === project.orgId && isLive(p) && p.name.toLowerCase() === nameKey
			)
		) {
			throw new ProviderError('projects_org_name_unique: project name already in use', 409);
		}
		if (
			store.projects.some((p) => p.orgId === project.orgId && isLive(p) && p.slug === project.slug)
		) {
			throw new ProviderError('projects_org_id_slug_key: project slug already in use', 409);
		}
		store.projects.push({ ...project, deletedAt: null });
		store.projectMembers.push({
			projectId: project.id,
			userId: project.ownerId,
			role: 'owner',
			joinedAt: project.createdAt,
			updatedAt: project.createdAt,
			updatedBy: project.ownerId,
			deletedAt: null
		});
		await this.loader.write(store);
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
		const store = await this.loader.get();
		const idx = store.projects.findIndex((p) => p.id === id && isLive(p));
		if (idx === -1) throw new ProviderError(`Project '${id}' not found`, 404);

		const current = store.projects[idx];

		if (patch.name && patch.name.toLowerCase() !== current.name.toLowerCase()) {
			const nameKey = patch.name.toLowerCase();
			if (
				store.projects.some(
					(p) =>
						p.orgId === current.orgId &&
						p.id !== id &&
						isLive(p) &&
						p.name.toLowerCase() === nameKey
				)
			) {
				throw new ProviderError('projects_org_name_unique: project name already in use', 409);
			}
		}

		if (patch.slug && patch.slug !== current.slug) {
			if (
				store.projects.some(
					(p) => p.orgId === current.orgId && p.slug === patch.slug && p.id !== id && isLive(p)
				)
			) {
				throw new ProviderError('projects_org_id_slug_key: project slug already in use', 409);
			}
		}

		store.projects[idx] = {
			...current,
			...patch,
			...auditUpdate(ctx, current.updatedBy ?? current.ownerId)
		};
		await this.loader.write(store);
	}

	async deleteProject(ctx: RequestContext, id: string): Promise<void> {
		const store = await this.loader.get();
		const idx = store.projects.findIndex((p) => p.id === id && isLive(p));
		if (idx === -1) throw new ProviderError(`Project '${id}' not found`, 404);
		const stamp = auditSoftDelete(
			ctx,
			store.projects[idx].updatedBy ?? store.projects[idx].ownerId
		);
		store.projects[idx] = { ...store.projects[idx], ...stamp };
		store.projectMembers = store.projectMembers.map((m) =>
			m.projectId === id && isLive(m) ? { ...m, ...stamp } : m
		);
		await this.loader.write(store);
		// A deleted project must stop serving its definitions — they surface in
		// library/public listings keyed on the definition row, independent of
		// the project. Supabase does the same cascade.
		await this.definitions?.deleteByProject(ctx, id);
		// Grants have no soft-delete column, so this hard-deletes them.
		await this.grants.deleteByProject(ctx, id);
		await this.events.emit({ type: 'project.deleted', projectId: id, actorId: actorFrom(ctx) });
	}

	async reactivateProject(
		ctx: RequestContext,
		orgId: string,
		slug: string
	): Promise<Project | null> {
		const store = await this.loader.get();
		const idx = store.projects.findIndex((p) => p.orgId === orgId && p.slug === slug && !isLive(p));
		if (idx === -1) return null;

		const now = new Date().toISOString();
		store.projects[idx] = { ...store.projects[idx], deletedAt: null, updatedAt: now };

		const ownerId = store.projects[idx].ownerId;
		const pmIdx = store.projectMembers.findIndex(
			(m) => m.projectId === store.projects[idx].id && m.userId === ownerId && !isLive(m)
		);
		if (pmIdx !== -1) {
			store.projectMembers[pmIdx] = {
				...store.projectMembers[pmIdx],
				deletedAt: null,
				updatedAt: now
			};
		}

		await this.loader.write(store);
		const project = { ...store.projects[idx] };
		await this.events.emit({
			type: 'project.created',
			projectId: project.id,
			orgId: project.orgId,
			actorId: actorFrom(ctx)
		});
		return project;
	}

	async listProjectMembers(
		_ctx: RequestContext,
		projectId: string,
		opts?: ListOptions
	): Promise<Page<ProjectMember>> {
		const { projectMembers } = await this.loader.get();
		return paginate(
			projectMembers.filter((m) => m.projectId === projectId && isLive(m)),
			opts
		);
	}

	async getProjectMember(
		_ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<ProjectMember | null> {
		const { projectMembers } = await this.loader.get();
		const m = projectMembers.find((m) => m.projectId === projectId && m.userId === userId);
		return m && isLive(m) ? m : null;
	}

	async getProjectMembersFor(
		_ctx: RequestContext,
		projectIds: readonly string[],
		userId: string
	): Promise<Map<string, ProjectMember | null>> {
		const { projectMembers } = await this.loader.get();
		const byProjectId = new Map(
			projectMembers.filter((m) => m.userId === userId && isLive(m)).map((m) => [m.projectId, m])
		);
		return new Map(projectIds.map((id) => [id, byProjectId.get(id) ?? null]));
	}

	async addProjectMember(ctx: RequestContext, member: ProjectMember): Promise<void> {
		const store = await this.loader.get();
		// Reactivate a prior soft-deleted row rather than piling rows up.
		const existing = store.projectMembers.find(
			(m) => m.projectId === member.projectId && m.userId === member.userId
		);
		if (existing) {
			Object.assign(existing, member, {
				...auditUpdate(ctx, member.userId),
				deletedAt: null
			});
		} else {
			const stamp = auditUpdate(ctx, member.userId);
			store.projectMembers.push({
				...member,
				updatedAt: member.updatedAt ?? stamp.updatedAt,
				updatedBy: member.updatedBy ?? stamp.updatedBy,
				deletedAt: null
			});
		}
		await this.loader.write(store);
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
		const store = await this.loader.get();
		const m = store.projectMembers.find(
			(m) => m.projectId === projectId && m.userId === userId && isLive(m)
		);
		if (!m) throw new ProviderError(`Project member '${userId}' not found`, 404);
		m.role = role;
		Object.assign(m, auditUpdate(ctx, m.updatedBy));
		await this.loader.write(store);
		await this.events.emit({
			type: 'project_member.role_changed',
			projectId,
			userId,
			role,
			actorId: actorFrom(ctx)
		});
	}

	async removeProjectMember(ctx: RequestContext, projectId: string, userId: string): Promise<void> {
		const store = await this.loader.get();
		const m = store.projectMembers.find(
			(m) => m.projectId === projectId && m.userId === userId && isLive(m)
		);
		if (!m) return;
		Object.assign(m, auditSoftDelete(ctx, m.updatedBy));
		await this.loader.write(store);
		await this.events.emit({
			type: 'project_member.removed',
			projectId,
			userId,
			actorId: actorFrom(ctx)
		});
	}
}
