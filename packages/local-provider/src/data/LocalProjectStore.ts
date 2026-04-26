import type {
	IProjectStore,
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

export class LocalProjectStore implements IProjectStore {
	private readonly loader: LocalOrgStoreLoader;
	private readonly events: IEventSink;

	constructor(loader: LocalOrgStoreLoader, events: IEventSink = new NoopEventSink()) {
		this.loader = loader;
		this.events = events;
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
		await this.events.emit({ type: 'project.deleted', projectId: id, actorId: actorFrom(ctx) });
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
