import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
	IOrgStore,
	Organization,
	OrgRole,
	OrgMember,
	Project,
	ProjectMember,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
import { paginate, applyOrder } from '../pagination.js';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

export interface LocalOrgStore {
	org: Organization;
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

/**
 * Shared loader for the local-org.json file. Both LocalOrganizationProvider
 * and LocalProjectProvider point to the same instance so all reads and writes
 * go through one cache and one atomic write path.
 */
export class LocalOrgStoreLoader {
	readonly storePath: string;
	private store: LocalOrgStore | null = null;

	constructor(dataPath: string) {
		this.storePath = path.join(dataPath, 'local-org.json');
	}

	async get(): Promise<LocalOrgStore> {
		if (this.store) return this.store;

		const existing = await readJsonFile<LocalOrgStore | null>(this.storePath, null);
		if (existing) {
			this.store = existing;
			return existing;
		}

		const now = new Date().toISOString();
		const orgId = randomUUID();
		const projectId = randomUUID();
		const adminUserId = 'local-admin';

		this.store = {
			org: {
				id: orgId,
				name: 'Local',
				slug: 'local',
				ownerId: adminUserId,
				createdAt: now,
				updatedAt: now
			},
			projects: [
				{
					id: projectId,
					orgId,
					name: 'Default',
					slug: 'default',
					visibility: 'public',
					ownerId: adminUserId,
					createdAt: now,
					updatedAt: now
				}
			],
			orgMembers: [{ orgId, userId: adminUserId, role: 'owner', joinedAt: now }],
			projectMembers: [{ projectId, userId: adminUserId, role: 'owner', joinedAt: now }]
		};
		await this.write(this.store);
		return this.store;
	}

	async write(store: LocalOrgStore): Promise<void> {
		this.store = store;
		await writeJsonFile(this.storePath, store);
	}
}

export class LocalOrganizationProvider implements IOrgStore {
	private readonly loader: LocalOrgStoreLoader;

	static fromEnv(env: Record<string, string | undefined>): LocalOrganizationProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalOrganizationProvider(new LocalOrgStoreLoader(env.DATA_PATH));
	}

	constructor(loader: LocalOrgStoreLoader) {
		this.loader = loader;
	}

	// ── Organizations ────────────────────────────────────────────────────────────

	async listOrgs(_ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>> {
		const all = [(await this.loader.get()).org];
		return paginate(applyOrder(all, opts), opts);
	}

	async getOrg(_ctx: RequestContext, id: string): Promise<Organization | null> {
		const { org } = await this.loader.get();
		return org.id === id ? org : null;
	}

	async getOrgBySlug(_ctx: RequestContext, slug: string): Promise<Organization | null> {
		const { org } = await this.loader.get();
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
		const store = await this.loader.get();
		if (store.org.id !== id) throw new ProviderError(`Org '${id}' not found`, 404);
		store.org = { ...store.org, ...patch, updatedAt: new Date().toISOString() };
		await this.loader.write(store);
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
		const { orgMembers } = await this.loader.get();
		return paginate(orgMembers.filter((m) => m.orgId === orgId), opts);
	}

	async getOrgMember(
		_ctx: RequestContext,
		orgId: string,
		userId: string
	): Promise<OrgMember | null> {
		const { orgMembers } = await this.loader.get();
		return orgMembers.find((m) => m.orgId === orgId && m.userId === userId) ?? null;
	}

	async addOrgMember(_ctx: RequestContext, member: OrgMember): Promise<void> {
		const store = await this.loader.get();
		store.orgMembers.push(member);
		await this.loader.write(store);
	}

	async updateOrgMemberRole(
		_ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void> {
		const store = await this.loader.get();
		const m = store.orgMembers.find((m) => m.orgId === orgId && m.userId === userId);
		if (!m) throw new ProviderError(`Org member '${userId}' not found`, 404);
		m.role = role;
		await this.loader.write(store);
	}

	async removeOrgMember(_ctx: RequestContext, orgId: string, userId: string): Promise<void> {
		const store = await this.loader.get();
		store.orgMembers = store.orgMembers.filter(
			(m) => !(m.orgId === orgId && m.userId === userId)
		);
		await this.loader.write(store);
	}
}
