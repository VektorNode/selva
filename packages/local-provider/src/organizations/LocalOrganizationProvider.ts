import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
	IOrganizationProvider,
	Organization,
	OrgRole,
	OrgMember,
	Project,
	ProjectVisibility,
	ProjectRole,
	ProjectMember
} from '@selva/platform/organizations';
import { ProviderError } from '@selva/platform';

interface LocalOrgStore {
	org: Organization;
	project: Project;
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

export class LocalOrganizationProvider implements IOrganizationProvider {
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

		this.store = { org, project, orgMembers: [orgMember], projectMembers: [projectMember] };
		await this.writeStore(this.store);
		return this.store;
	}

	private async writeStore(store: LocalOrgStore): Promise<void> {
		await fs.mkdir(path.dirname(this.storePath), { recursive: true });
		const tmp = `${this.storePath}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(store, null, '\t'), 'utf-8');
		await fs.rename(tmp, this.storePath);
	}

	// ── Helper: get the single default project ID ────────────────────────────────

	/** Returns the single default project ID for this local install. */
	async getDefaultProjectId(): Promise<string> {
		return (await this.getStore()).project.id;
	}

	// ── Organizations ────────────────────────────────────────────────────────────

	async listOrgs(): Promise<Organization[]> {
		return [(await this.getStore()).org];
	}

	async getOrg(id: string): Promise<Organization | null> {
		const { org } = await this.getStore();
		return org.id === id ? org : null;
	}

	async getOrgBySlug(slug: string): Promise<Organization | null> {
		const { org } = await this.getStore();
		return org.slug === slug ? org : null;
	}

	async createOrg(_org: Organization): Promise<void> {
		throw new ProviderError('Multiple organizations are not supported in local mode', 403);
	}

	async updateOrg(id: string, patch: Partial<Pick<Organization, 'name' | 'slug'>>): Promise<void> {
		const store = await this.getStore();
		if (store.org.id !== id) throw new ProviderError(`Org '${id}' not found`, 404);
		store.org = { ...store.org, ...patch, updatedAt: new Date().toISOString() };
		await this.writeStore(store);
	}

	async deleteOrg(_id: string): Promise<void> {
		throw new ProviderError('Deleting the organization is not supported in local mode', 403);
	}

	// ── Org members ──────────────────────────────────────────────────────────────

	async listOrgMembers(orgId: string): Promise<OrgMember[]> {
		const { orgMembers } = await this.getStore();
		return orgMembers.filter((m) => m.orgId === orgId);
	}

	async getOrgMember(orgId: string, userId: string): Promise<OrgMember | null> {
		const { orgMembers } = await this.getStore();
		return orgMembers.find((m) => m.orgId === orgId && m.userId === userId) ?? null;
	}

	async addOrgMember(member: OrgMember): Promise<void> {
		const store = await this.getStore();
		store.orgMembers.push(member);
		await this.writeStore(store);
	}

	async updateOrgMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
		const store = await this.getStore();
		const m = store.orgMembers.find((m) => m.orgId === orgId && m.userId === userId);
		if (!m) throw new ProviderError(`Org member '${userId}' not found`, 404);
		m.role = role;
		await this.writeStore(store);
	}

	async removeOrgMember(orgId: string, userId: string): Promise<void> {
		const store = await this.getStore();
		store.orgMembers = store.orgMembers.filter((m) => !(m.orgId === orgId && m.userId === userId));
		await this.writeStore(store);
	}

	// ── Projects ─────────────────────────────────────────────────────────────────

	async listProjects(orgId: string): Promise<Project[]> {
		const { project } = await this.getStore();
		return project.orgId === orgId ? [project] : [];
	}

	async getProject(id: string): Promise<Project | null> {
		const { project } = await this.getStore();
		return project.id === id ? project : null;
	}

	async getProjectBySlug(orgId: string, slug: string): Promise<Project | null> {
		const { project } = await this.getStore();
		return project.orgId === orgId && project.slug === slug ? project : null;
	}

	async createProject(_project: Project): Promise<void> {
		throw new ProviderError('Multiple projects are not supported in local mode', 403);
	}

	async updateProject(
		id: string,
		patch: Partial<Pick<Project, 'name' | 'slug' | 'description' | 'visibility'>>
	): Promise<void> {
		const store = await this.getStore();
		if (store.project.id !== id) throw new ProviderError(`Project '${id}' not found`, 404);
		store.project = { ...store.project, ...patch, updatedAt: new Date().toISOString() };
		await this.writeStore(store);
	}

	async deleteProject(_id: string): Promise<void> {
		throw new ProviderError('Deleting the default project is not supported in local mode', 403);
	}

	// ── Project members ──────────────────────────────────────────────────────────

	async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
		const { projectMembers } = await this.getStore();
		return projectMembers.filter((m) => m.projectId === projectId);
	}

	async getProjectMember(projectId: string, userId: string): Promise<ProjectMember | null> {
		const { projectMembers } = await this.getStore();
		return projectMembers.find((m) => m.projectId === projectId && m.userId === userId) ?? null;
	}

	async addProjectMember(member: ProjectMember): Promise<void> {
		const store = await this.getStore();
		store.projectMembers.push(member);
		await this.writeStore(store);
	}

	async updateProjectMemberRole(
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

	async removeProjectMember(projectId: string, userId: string): Promise<void> {
		const store = await this.getStore();
		store.projectMembers = store.projectMembers.filter(
			(m) => !(m.projectId === projectId && m.userId === userId)
		);
		await this.writeStore(store);
	}

	// ── Access checks ─────────────────────────────────────────────────────────────
	// Single-tenant: all authenticated users can do everything.

	async canSolve(_userId: string, _projectId: string): Promise<boolean> {
		return true;
	}

	async canEdit(_userId: string, _projectId: string): Promise<boolean> {
		return true;
	}

	async canManage(_userId: string, _projectId: string): Promise<boolean> {
		return true;
	}
}
