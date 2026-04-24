import * as path from 'node:path';
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
	orgs: Organization[];
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

const EMPTY_STORE: LocalOrgStore = {
	orgs: [],
	projects: [],
	orgMembers: [],
	projectMembers: []
};

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
 * Legacy on-disk shape (pre multi-org refactor): `{ org: Organization, ... }`.
 * Migrated on first read into the array-shaped `LocalOrgStore`.
 */
interface LegacyLocalOrgStore {
	org?: Organization;
	orgs?: Organization[];
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

/**
 * Shared loader for the local-org.json file. Both LocalOrganizationProvider
 * and LocalProjectProvider point to the same instance so all reads and writes
 * go through one cache and one atomic write path.
 *
 * The store starts empty — orgs are created explicitly via `createOrg`
 * (typically from the setup flow). No lazy seeding.
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

		const raw = await readJsonFile<LegacyLocalOrgStore | null>(this.storePath, null);
		if (!raw) {
			this.store = { ...EMPTY_STORE, orgs: [], projects: [], orgMembers: [], projectMembers: [] };
			return this.store;
		}

		// Migrate the singleton `org` field to the new `orgs[]` array.
		const orgs: Organization[] = raw.orgs ?? (raw.org ? [raw.org] : []);
		const store: LocalOrgStore = {
			orgs,
			projects: raw.projects ?? [],
			orgMembers: raw.orgMembers ?? [],
			projectMembers: raw.projectMembers ?? []
		};

		// Migrate legacy members (no permissions field) in place.
		let changed = raw.orgs === undefined && raw.org !== undefined;
		for (const m of store.orgMembers) {
			const before = m.permissions;
			migrateOrgMember(m);
			if (before === undefined) changed = true;
		}
		// One-time sweep: apply legacy user-level OrgPermissions to memberships.
		if (this.userMeta) {
			for (const m of store.orgMembers) {
				const legacy = await this.userMeta.consumeLegacyOrgPermissions(m.userId);
				if (legacy) {
					const extra = sanitizeOrgPermissions(legacy);
					m.permissions = Array.from(new Set([...(m.permissions ?? []), ...extra]));
					changed = true;
				}
			}
		}
		this.store = store;
		if (changed) await this.write(store);
		return store;
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
		const { orgs } = await this.loader.get();
		return paginate(applyOrder(orgs, opts), opts);
	}

	async getOrg(_ctx: RequestContext, id: string): Promise<Organization | null> {
		const { orgs } = await this.loader.get();
		return orgs.find((o) => o.id === id) ?? null;
	}

	async getOrgBySlug(_ctx: RequestContext, slug: string): Promise<Organization | null> {
		const { orgs } = await this.loader.get();
		return orgs.find((o) => o.slug === slug) ?? null;
	}

	async createOrg(_ctx: RequestContext, org: Organization): Promise<void> {
		const store = await this.loader.get();
		if (store.orgs.some((o) => o.id === org.id)) {
			throw new ProviderError(`Org '${org.id}' already exists`, 409);
		}
		if (store.orgs.some((o) => o.slug === org.slug)) {
			throw new ProviderError(`Org slug '${org.slug}' already in use`, 409);
		}
		store.orgs.push(org);
		// Seed the owner membership so the creator can see their own org through
		// downstream permission checks. Mirrors SupabaseOrgStore.createOrg.
		store.orgMembers.push({
			orgId: org.id,
			userId: org.ownerId,
			role: 'owner',
			permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
			joinedAt: new Date().toISOString()
		});
		await this.loader.write(store);
	}

	async updateOrg(
		_ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug'>>
	): Promise<void> {
		const store = await this.loader.get();
		const idx = store.orgs.findIndex((o) => o.id === id);
		if (idx === -1) throw new ProviderError(`Org '${id}' not found`, 404);
		if (patch.slug && patch.slug !== store.orgs[idx].slug) {
			if (store.orgs.some((o) => o.id !== id && o.slug === patch.slug)) {
				throw new ProviderError(`Org slug '${patch.slug}' already in use`, 409);
			}
		}
		store.orgs[idx] = { ...store.orgs[idx], ...patch, updatedAt: new Date().toISOString() };
		await this.loader.write(store);
	}

	async deleteOrg(_ctx: RequestContext, id: string): Promise<void> {
		const store = await this.loader.get();
		const idx = store.orgs.findIndex((o) => o.id === id);
		if (idx === -1) throw new ProviderError(`Org '${id}' not found`, 404);
		store.orgs.splice(idx, 1);
		store.orgMembers = store.orgMembers.filter((m) => m.orgId !== id);
		// Cascade: drop projects + project members in this org.
		const droppedProjectIds = new Set(
			store.projects.filter((p) => p.orgId === id).map((p) => p.id)
		);
		store.projects = store.projects.filter((p) => p.orgId !== id);
		store.projectMembers = store.projectMembers.filter((m) => !droppedProjectIds.has(m.projectId));
		await this.loader.write(store);
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
