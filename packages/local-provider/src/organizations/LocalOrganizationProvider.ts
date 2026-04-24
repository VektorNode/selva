import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
	IOrgStore,
	Organization,
	OrgRole,
	OrgPermission,
	OrgMember,
	Project,
	ProjectMember,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { DEFAULT_ORG_PERMISSIONS, ProviderError, ALL_ORG_PERMISSIONS } from '@selva/platform';
import { createLocalUserMetaProvider } from '../auth/users.js';
import type { LocalUserMetaProvider } from '../auth/users.js';
import { paginate, applyOrder } from '../pagination.js';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

export interface LocalOrgStore {
	org: Organization;
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

const VALID_ORG_PERMS = new Set<OrgPermission>(ALL_ORG_PERMISSIONS);

function sanitizeOrgPermissions(raw: readonly string[] | undefined): OrgPermission[] {
	if (!raw) return [];
	return raw.filter((p): p is OrgPermission => VALID_ORG_PERMS.has(p as OrgPermission));
}

/**
 * Pre-§1g OrgMember records had no `permissions` field. Backfill from the
 * role's defaults so existing `local-org.json` files keep working.
 */
function migrateOrgMember(m: OrgMember & { permissions?: OrgPermission[] }): OrgMember {
	if (!m.permissions) m.permissions = [...DEFAULT_ORG_PERMISSIONS[m.role]];
	return m;
}

/**
 * Shared loader for the local-org.json file. Both LocalOrganizationProvider
 * and LocalProjectProvider point to the same instance so all reads and writes
 * go through one cache and one atomic write path.
 */
export class LocalOrgStoreLoader {
	readonly storePath: string;
	private readonly usersPath: string;
	private readonly userMeta: LocalUserMetaProvider | null;
	private store: LocalOrgStore | null = null;

	constructor(dataPath: string) {
		this.storePath = path.join(dataPath, 'local-org.json');
		this.usersPath = path.join(dataPath, 'users.json');
		this.userMeta = createLocalUserMetaProvider(this.usersPath);
	}

	async get(): Promise<LocalOrgStore> {
		if (this.store) {
			return this.store;
		}

		const existing = await readJsonFile<LocalOrgStore | null>(this.storePath, null);
		if (existing) {
			// Migrate legacy members (no permissions field) in place.
			let changed = false;
			for (const m of existing.orgMembers) {
				const before = m.permissions;
				migrateOrgMember(m);
				if (before === undefined) changed = true;
			}
			// One-time sweep: apply legacy user-level OrgPermissions (read out of
			// users.json by the migrateUser helper) to each member record.
			if (this.userMeta) {
				for (const m of existing.orgMembers) {
					const legacy = await this.userMeta.consumeLegacyOrgPermissions(m.userId);
					if (legacy) {
						const extra = sanitizeOrgPermissions(legacy);
						m.permissions = Array.from(new Set([...(m.permissions ?? []), ...extra]));
						changed = true;
					}
				}
			}
			this.store = existing;
			if (changed) await this.write(existing);
			return existing;
		}

		const now = new Date().toISOString();
		const orgId = randomUUID();
		const projectId = randomUUID();
		// Prefer the first real user (from setup) over the synthetic fallback so
		// project/org membership checks work for the actual admin account.
		const usersFile = await readJsonFile<{ users?: Array<{ id: string }> } | null>(
			this.usersPath,
			null
		);
		const adminUserId = usersFile?.users?.[0]?.id ?? 'local-admin';

		// First admin is the org owner with every OrgPermission on the default org.
		// Platform-admin status (§1g-ui: restricted) is a separate concern — setup
		// still grants it via LocalAuthProvider while the §1g-ui rebuild is pending.
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
			orgMembers: [
				{
					orgId,
					userId: adminUserId,
					role: 'owner',
					permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
					joinedAt: now
				}
			],
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
		return paginate(
			orgMembers.filter((m) => m.orgId === orgId).map(migrateOrgMember),
			opts
		);
	}

	async getOrgMember(
		_ctx: RequestContext,
		orgId: string,
		userId: string
	): Promise<OrgMember | null> {
		const { orgMembers } = await this.loader.get();
		const m = orgMembers.find((m) => m.orgId === orgId && m.userId === userId);
		return m ? migrateOrgMember(m) : null;
	}

	async addOrgMember(_ctx: RequestContext, member: OrgMember): Promise<void> {
		const store = await this.loader.get();
		// If callers forget to pass permissions, seed from role defaults.
		const full: OrgMember = {
			...member,
			permissions: member.permissions ?? [...DEFAULT_ORG_PERMISSIONS[member.role]]
		};
		store.orgMembers.push(full);
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
		// Role change re-seeds the permission defaults. Callers that want to
		// preserve a custom OrgPermission set must call updateOrgMemberPermissions
		// (once §1g-ui adds it) after updating the role.
		m.permissions = [...DEFAULT_ORG_PERMISSIONS[role]];
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
