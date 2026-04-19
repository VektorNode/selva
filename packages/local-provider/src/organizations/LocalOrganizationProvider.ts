import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
	IOrgStore,
	Organization,
	OrgRole,
	OrgMember,
	Project,
	ProjectRole,
	ProjectMember,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { ProviderError, hasPermission } from '@selva/platform';
import { paginate, applyOrder } from '../pagination.js';

interface LocalOrgStore {
	org: Organization;
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}


export class LocalOrganizationProvider implements IOrgStore {
	private readonly storePath: string;
	private store: LocalOrgStore | null = null;

	static fromEnv(env: Record<string, string | undefined>): LocalOrganizationProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalOrganizationProvider(env.DATA_PATH);
	}

	constructor(definitionsPath: string) {
		this.storePath = path.join(definitionsPath, 'local-org.json');
	}

	// ── Bootstrap ───────────────────────────────────────────────────────────────

	private async getStore(): Promise<LocalOrgStore> {
		if (this.store) return this.store;

		try {
			const content = await fs.readFile(this.storePath, 'utf-8');
			this.store = JSON.parse(content) as LocalOrgStore;
			return this.store;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
		}

		// Bootstrap a default org and project on first use
		const now = new Date().toISOString();
		const orgId = randomUUID();
		const projectId = randomUUID();
		const adminUserId = 'local-admin';

		const org: Organization = {
			id: orgId,
			name: 'Local',
			slug: 'local',
			ownerId: adminUserId,
			createdAt: now,
			updatedAt: now
		};

		const project: Project = {
			id: projectId,
			orgId,
			name: 'Default',
			slug: 'default',
			visibility: 'public',
			ownerId: adminUserId,
			createdAt: now,
			updatedAt: now
		};

		const orgMember: OrgMember = {
			orgId,
			userId: adminUserId,
			role: 'owner',
			joinedAt: now
		};

		const projectMember: ProjectMember = {
			projectId,
			userId: adminUserId,
			role: 'owner',
			joinedAt: now
		};

		this.store = { org, projects: [project], orgMembers: [orgMember], projectMembers: [projectMember] };
		await this.writeStore(this.store);
		return this.store;
	}

	private async writeStore(store: LocalOrgStore): Promise<void> {
		await fs.mkdir(path.dirname(this.storePath), { recursive: true });
		const tmp = `${this.storePath}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(store, null, '\t'), 'utf-8');
		await fs.rename(tmp, this.storePath);
	}

	/** Returns the first project ID — used as the default target for uploads. */
	async getDefaultProjectId(): Promise<string> {
		const { projects } = await this.getStore();
		if (projects.length === 0) throw new ProviderError('No projects configured', 500);
		return projects[0].id;
	}

	// ── Organizations ────────────────────────────────────────────────────────────

	async listOrgs(_ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>> {
		const all = [(await this.getStore()).org];
		return paginate(applyOrder(all, opts), opts);
	}

	async getOrg(_ctx: RequestContext, id: string): Promise<Organization | null> {
		const { org } = await this.getStore();
		return org.id === id ? org : null;
	}

	async getOrgBySlug(_ctx: RequestContext, slug: string): Promise<Organization | null> {
		const { org } = await this.getStore();
		return org.slug === slug ? org : null;
	}

	async createOrg(_ctx: RequestContext, _org: Organization): Promise<void> {
		throw new ProviderError('Multiple organizations are not supported in local mode', 403);
	}

	async updateOrg(
		_ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug'>>
	): Promise<void> {
		const store = await this.getStore();
		if (store.org.id !== id) throw new ProviderError(`Org '${id}' not found`, 404);
		store.org = { ...store.org, ...patch, updatedAt: new Date().toISOString() };
		await this.writeStore(store);
	}

	async deleteOrg(_ctx: RequestContext, _id: string): Promise<void> {
		throw new ProviderError('Deleting the organization is not supported in local mode', 403);
	}

	// ── Org members ──────────────────────────────────────────────────────────────

	async listOrgMembers(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<OrgMember>> {
		const { orgMembers } = await this.getStore();
		const filtered = orgMembers.filter((m) => m.orgId === orgId);
		return paginate(filtered, opts);
	}

	async getOrgMember(
		_ctx: RequestContext,
		orgId: string,
		userId: string
	): Promise<OrgMember | null> {
		const { orgMembers } = await this.getStore();
		return orgMembers.find((m) => m.orgId === orgId && m.userId === userId) ?? null;
	}

	async addOrgMember(_ctx: RequestContext, member: OrgMember): Promise<void> {
		const store = await this.getStore();
		store.orgMembers.push(member);
		await this.writeStore(store);
	}

	async updateOrgMemberRole(
		_ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void> {
		const store = await this.getStore();
		const m = store.orgMembers.find((m) => m.orgId === orgId && m.userId === userId);
		if (!m) throw new ProviderError(`Org member '${userId}' not found`, 404);
		m.role = role;
		await this.writeStore(store);
	}

	async removeOrgMember(_ctx: RequestContext, orgId: string, userId: string): Promise<void> {
		const store = await this.getStore();
		store.orgMembers = store.orgMembers.filter(
			(m) => !(m.orgId === orgId && m.userId === userId)
		);
		await this.writeStore(store);
	}

	// ── Projects ─────────────────────────────────────────────────────────────────

	async listProjects(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<Project>> {
		const { projects } = await this.getStore();
		const items = projects.filter((p) => p.orgId === orgId);
		return paginate(applyOrder(items, opts), opts);
	}

	async getProject(_ctx: RequestContext, id: string): Promise<Project | null> {
		const { projects } = await this.getStore();
		return projects.find((p) => p.id === id) ?? null;
	}

	async getProjectBySlug(
		_ctx: RequestContext,
		orgId: string,
		slug: string
	): Promise<Project | null> {
		const { projects } = await this.getStore();
		return projects.find((p) => p.orgId === orgId && p.slug === slug) ?? null;
	}

	async createProject(_ctx: RequestContext, project: Project): Promise<void> {
		const store = await this.getStore();
		if (project.orgId !== store.org.id) {
			throw new ProviderError(`Org '${project.orgId}' not found`, 404);
		}
		if (store.projects.some((p) => p.id === project.id)) {
			throw new ProviderError(`Project '${project.id}' already exists`, 409);
		}
		if (store.projects.some((p) => p.orgId === project.orgId && p.slug === project.slug)) {
			throw new ProviderError(`Project slug '${project.slug}' already in use`, 409);
		}
		store.projects.push(project);
		await this.writeStore(store);
	}

	async updateProject(
		_ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Project, 'name' | 'slug' | 'description' | 'visibility'>>
	): Promise<void> {
		const store = await this.getStore();
		const idx = store.projects.findIndex((p) => p.id === id);
		if (idx === -1) throw new ProviderError(`Project '${id}' not found`, 404);

		if (patch.slug && patch.slug !== store.projects[idx].slug) {
			const orgId = store.projects[idx].orgId;
			if (store.projects.some((p) => p.orgId === orgId && p.slug === patch.slug && p.id !== id)) {
				throw new ProviderError(`Project slug '${patch.slug}' already in use`, 409);
			}
		}

		store.projects[idx] = {
			...store.projects[idx],
			...patch,
			updatedAt: new Date().toISOString()
		};
		await this.writeStore(store);
	}

	async deleteProject(_ctx: RequestContext, id: string): Promise<void> {
		const store = await this.getStore();
		const idx = store.projects.findIndex((p) => p.id === id);
		if (idx === -1) throw new ProviderError(`Project '${id}' not found`, 404);
		if (store.projects.length === 1) {
			throw new ProviderError('Cannot delete the last remaining project', 409);
		}
		store.projects.splice(idx, 1);
		store.projectMembers = store.projectMembers.filter((m) => m.projectId !== id);
		await this.writeStore(store);
	}

	// ── Project members ──────────────────────────────────────────────────────────

	async listProjectMembers(
		_ctx: RequestContext,
		projectId: string,
		opts?: ListOptions
	): Promise<Page<ProjectMember>> {
		const { projectMembers } = await this.getStore();
		const filtered = projectMembers.filter((m) => m.projectId === projectId);
		return paginate(filtered, opts);
	}

	async getProjectMember(
		_ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<ProjectMember | null> {
		const { projectMembers } = await this.getStore();
		return projectMembers.find((m) => m.projectId === projectId && m.userId === userId) ?? null;
	}

	async addProjectMember(_ctx: RequestContext, member: ProjectMember): Promise<void> {
		const store = await this.getStore();
		store.projectMembers.push(member);
		await this.writeStore(store);
	}

	async updateProjectMemberRole(
		_ctx: RequestContext,
		projectId: string,
		userId: string,
		role: ProjectRole
	): Promise<void> {
		const store = await this.getStore();
		const m = store.projectMembers.find((m) => m.projectId === projectId && m.userId === userId);
		if (!m) throw new ProviderError(`Project member '${userId}' not found`, 404);
		m.role = role;
		await this.writeStore(store);
	}

	async removeProjectMember(
		_ctx: RequestContext,
		projectId: string,
		userId: string
	): Promise<void> {
		const store = await this.getStore();
		store.projectMembers = store.projectMembers.filter(
			(m) => !(m.projectId === projectId && m.userId === userId)
		);
		await this.writeStore(store);
	}

	// ── Access checks ─────────────────────────────────────────────────────────────
	// UI gating only — the mutating methods above are the real security boundary.

	async canSolve(_ctx: RequestContext, _projectId: string): Promise<boolean> {
		// Any authenticated user can trigger solves
		return true;
	}

	async canEdit(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (hasPermission(ctx.permissions, 'platform_admin')) return true;
		const { projectMembers } = await this.getStore();
		const member = projectMembers.find((m) => m.projectId === projectId && m.userId === ctx.userId);
		return member?.role === 'owner' || member?.role === 'editor';
	}

	async canManage(ctx: RequestContext, projectId: string): Promise<boolean> {
		if (hasPermission(ctx.permissions, 'platform_admin')) return true;
		const { projectMembers } = await this.getStore();
		const member = projectMembers.find((m) => m.projectId === projectId && m.userId === ctx.userId);
		return member?.role === 'owner';
	}
}
