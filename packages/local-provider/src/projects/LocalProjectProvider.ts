import type {
	IProjectStore,
	Project,
	ProjectRole,
	ProjectMember,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { ProviderError, hasPermission } from '@selva/platform';
import { paginate, applyOrder } from '../pagination.js';
import type { LocalOrgStoreLoader } from '../organizations/LocalOrganizationProvider.js';

export class LocalProjectProvider implements IProjectStore {
	private readonly loader: LocalOrgStoreLoader;

	constructor(loader: LocalOrgStoreLoader) {
		this.loader = loader;
	}

	// ── Projects ─────────────────────────────────────────────────────────────────

	async listProjects(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<Project>> {
		const { projects } = await this.loader.get();
		return paginate(applyOrder(projects.filter((p) => p.orgId === orgId), opts), opts);
	}

	async getProject(_ctx: RequestContext, id: string): Promise<Project | null> {
		const { projects } = await this.loader.get();
		return projects.find((p) => p.id === id) ?? null;
	}

	async getProjectBySlug(
		_ctx: RequestContext,
		orgId: string,
		slug: string
	): Promise<Project | null> {
		const { projects } = await this.loader.get();
		return projects.find((p) => p.orgId === orgId && p.slug === slug) ?? null;
	}

	async createProject(_ctx: RequestContext, project: Project): Promise<void> {
		const store = await this.loader.get();
		if (!store.orgs.some((o) => o.id === project.orgId)) {
			throw new ProviderError(`Org '${project.orgId}' not found`, 404);
		}
		if (store.projects.some((p) => p.id === project.id)) {
			throw new ProviderError(`Project '${project.id}' already exists`, 409);
		}
		const nameKey = project.name.toLowerCase();
		if (
			store.projects.some((p) => p.orgId === project.orgId && p.name.toLowerCase() === nameKey)
		) {
			throw new ProviderError('projects_org_name_unique: project name already in use', 409);
		}
		if (store.projects.some((p) => p.orgId === project.orgId && p.slug === project.slug)) {
			throw new ProviderError('projects_org_id_slug_key: project slug already in use', 409);
		}
		store.projects.push(project);
		store.projectMembers.push({
			projectId: project.id,
			userId: project.ownerId,
			role: 'owner',
			joinedAt: project.createdAt
		});
		await this.loader.write(store);
	}

	async updateProject(
		_ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Project, 'name' | 'slug' | 'description' | 'visibility'>>
	): Promise<void> {
		const store = await this.loader.get();
		const idx = store.projects.findIndex((p) => p.id === id);
		if (idx === -1) throw new ProviderError(`Project '${id}' not found`, 404);

		const current = store.projects[idx];

		if (patch.name && patch.name.toLowerCase() !== current.name.toLowerCase()) {
			const nameKey = patch.name.toLowerCase();
			if (
				store.projects.some(
					(p) => p.orgId === current.orgId && p.id !== id && p.name.toLowerCase() === nameKey
				)
			) {
				throw new ProviderError('projects_org_name_unique: project name already in use', 409);
			}
		}

		if (patch.slug && patch.slug !== current.slug) {
			if (
				store.projects.some(
					(p) => p.orgId === current.orgId && p.slug === patch.slug && p.id !== id
				)
			) {
				throw new ProviderError('projects_org_id_slug_key: project slug already in use', 409);
			}
		}

		store.projects[idx] = { ...current, ...patch, updatedAt: new Date().toISOString() };
		await this.loader.write(store);
	}

	async deleteProject(_ctx: RequestContext, id: string): Promise<void> {
		const store = await this.loader.get();
		const idx = store.projects.findIndex((p) => p.id === id);
		if (idx === -1) throw new ProviderError(`Project '${id}' not found`, 404);
		store.projects.splice(idx, 1);
		store.projectMembers = store.projectMembers.filter((m) => m.projectId !== id);
		await this.loader.write(store);
	}

	// ── Project members ──────────────────────────────────────────────────────────

	async listProjectMembers(
		_ctx: RequestContext,
		projectId: string,
		opts?: ListOptions
	): Promise<Page<ProjectMember>> {
		const { projectMembers } = await this.loader.get();
		return paginate(projectMembers.filter((m) => m.projectId === projectId), opts);
	}

	async getProjectMember(
		_ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<ProjectMember | null> {
		const { projectMembers } = await this.loader.get();
		return projectMembers.find((m) => m.projectId === projectId && m.userId === userId) ?? null;
	}

	async addProjectMember(_ctx: RequestContext, member: ProjectMember): Promise<void> {
		const store = await this.loader.get();
		store.projectMembers.push(member);
		await this.loader.write(store);
	}

	async updateProjectMemberRole(
		_ctx: RequestContext,
		projectId: string,
		userId: string,
		role: ProjectRole
	): Promise<void> {
		const store = await this.loader.get();
		const m = store.projectMembers.find((m) => m.projectId === projectId && m.userId === userId);
		if (!m) throw new ProviderError(`Project member '${userId}' not found`, 404);
		m.role = role;
		await this.loader.write(store);
	}

	async removeProjectMember(
		_ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<void> {
		const store = await this.loader.get();
		store.projectMembers = store.projectMembers.filter(
			(m) => !(m.projectId === projectId && m.userId === userId)
		);
		await this.loader.write(store);
	}

	// ── Access checks ─────────────────────────────────────────────────────────────
	// UI gating only — the mutating methods above are the real security boundary.

	async canEdit(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (hasPermission(ctx, 'instance_admin')) return true;
		const { projectMembers, projects, orgMembers } = await this.loader.get();
		const member = projectMembers.find((m) => m.projectId === projectId && m.userId === ctx.userId);
		if (member?.role === 'owner' || member?.role === 'editor') return true;
		// manage_definitions permission allows editing public projects in orgs where user is a member
		if (hasPermission(ctx, 'manage_definitions')) {
			const project = projects.find((p) => p.id === projectId);
			if (project?.visibility === 'public') {
				const isOrgMember = orgMembers.some((m) => m.orgId === project.orgId && m.userId === ctx.userId);
				return isOrgMember;
			}
		}
		return false;
	}

	async canManage(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (hasPermission(ctx, 'instance_admin')) return true;
		const { projectMembers } = await this.loader.get();
		const member = projectMembers.find((m) => m.projectId === projectId && m.userId === ctx.userId);
		return member?.role === 'owner';
	}

	async canEditProjectSettings(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (hasPermission(ctx, 'instance_admin')) return true;
		const { projectMembers } = await this.loader.get();
		const member = projectMembers.find((m) => m.projectId === projectId && m.userId === ctx.userId);
		// project owners can always edit
		if (member?.role === 'owner') return true;
		// manage_definitions permission allows editing project settings if they're an editor
		if (hasPermission(ctx, 'manage_definitions') && member?.role === 'editor') return true;
		return false;
	}

}
