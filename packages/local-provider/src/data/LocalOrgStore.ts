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
import { paginate, applyOrder } from './pagination.js';
import { readJsonFile, writeJsonFile } from './fsJson.js';

/** Shape of the on-disk local-org.json file. */
export interface LocalOrgStoreData {
	orgs: Organization[];
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

const EMPTY_STORE: LocalOrgStoreData = {
	orgs: [],
	projects: [],
	orgMembers: [],
	projectMembers: []
};

const VALID_ORG_PERMS = new Set<OrgPermission>(ALL_ORG_PERMISSIONS);

/** Data-access-layer filter: row is live (not soft-deleted). */
function isLive<T extends { deletedAt?: string | null }>(row: T): boolean {
	return row.deletedAt == null;
}

function sanitizeOrgPermissions(raw: readonly string[] | undefined): OrgPermission[] {
	if (!raw) return [];
	return raw.filter((p): p is OrgPermission => VALID_ORG_PERMS.has(p as OrgPermission));
}

/** Backfills fields added in later refactors so older JSON files keep working. */
function migrateOrgMember(m: OrgMember & { permissions?: OrgPermission[] }): OrgMember {
	if (!m.permissions) m.permissions = [...DEFAULT_ORG_PERMISSIONS[m.role]];
	if (!m.updatedAt) m.updatedAt = m.joinedAt;
	if (!m.updatedBy) m.updatedBy = m.userId;
	if (m.deletedAt === undefined) m.deletedAt = null;
	return m;
}

/** Pre-multi-org shape: `{ org: Organization, ... }`. Migrated on first read. */
interface LegacyLocalOrgStoreData {
	org?: Organization;
	orgs?: Organization[];
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

/**
 * Shared by LocalOrgStore and LocalProjectStore — one instance so all
 * reads/writes go through one cache and one atomic write path. The store
 * starts empty; orgs are created explicitly via `createOrg`.
 */
export class LocalOrgStoreLoader {
	readonly storePath: string;
	private readonly usersPath: string;
	private readonly userMeta: LocalUserMetaProvider | null;
	private store: LocalOrgStoreData | null = null;

	constructor(dataPath: string) {
		this.storePath = path.join(dataPath, 'local-org.json');
		this.usersPath = path.join(dataPath, 'users.json');
		this.userMeta = createLocalUserMetaProvider(this.usersPath);
	}

	async get(): Promise<LocalOrgStoreData> {
		if (this.store) {
			return this.store;
		}

		const raw = await readJsonFile<LegacyLocalOrgStoreData | null>(this.storePath, null);
		if (!raw) {
			this.store = { ...EMPTY_STORE, orgs: [], projects: [], orgMembers: [], projectMembers: [] };
			return this.store;
		}

		// Migrate the singleton `org` field to the new `orgs[]` array.
		const orgs: Organization[] = raw.orgs ?? (raw.org ? [raw.org] : []);
		const store: LocalOrgStoreData = {
			orgs,
			projects: raw.projects ?? [],
			orgMembers: raw.orgMembers ?? [],
			projectMembers: raw.projectMembers ?? []
		};

		let changed = raw.orgs === undefined && raw.org !== undefined;
		for (const m of store.orgMembers) {
			const before = m.permissions;
			migrateOrgMember(m);
			if (before === undefined) changed = true;
		}
		for (const p of store.projects as Array<
			Project & { autoJoinOnUpload?: boolean; allowAnonymous?: boolean }
		>) {
			if (p.autoJoinOnUpload === undefined) {
				p.autoJoinOnUpload = false;
				changed = true;
			}
			// Strip the dropped allowAnonymous flag if present in legacy on-disk data.
			if (p.allowAnonymous !== undefined) {
				delete p.allowAnonymous;
				changed = true;
			}
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

	async write(store: LocalOrgStoreData): Promise<void> {
		this.store = store;
		await writeJsonFile(this.storePath, store);
	}
}

export class LocalOrgStore implements IOrgStore {
	private readonly loader: LocalOrgStoreLoader;

	static fromEnv(env: Record<string, string | undefined>): LocalOrgStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalOrgStore(new LocalOrgStoreLoader(env.DATA_PATH));
	}

	constructor(loader: LocalOrgStoreLoader) {
		this.loader = loader;
	}

	async listOrgs(_ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>> {
		const { orgs } = await this.loader.get();
		return paginate(applyOrder(orgs.filter(isLive), opts), opts);
	}

	async getOrg(_ctx: RequestContext, id: string): Promise<Organization | null> {
		const { orgs } = await this.loader.get();
		const o = orgs.find((o) => o.id === id);
		return o && isLive(o) ? o : null;
	}

	async getOrgBySlug(_ctx: RequestContext, slug: string): Promise<Organization | null> {
		const { orgs } = await this.loader.get();
		const o = orgs.find((o) => o.slug === slug);
		return o && isLive(o) ? o : null;
	}

	async createOrg(ctx: RequestContext, org: Organization): Promise<void> {
		const store = await this.loader.get();
		if (store.orgs.some((o) => o.id === org.id && isLive(o))) {
			throw new ProviderError(`Org '${org.id}' already exists`, 409);
		}
		if (store.orgs.some((o) => o.slug === org.slug && isLive(o))) {
			throw new ProviderError(`Org slug '${org.slug}' already in use`, 409);
		}
		store.orgs.push({ ...org, deletedAt: null });
		const now = new Date().toISOString();
		store.orgMembers.push({
			orgId: org.id,
			userId: org.ownerId,
			role: 'owner',
			permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
			joinedAt: now,
			updatedAt: now,
			updatedBy: ctx.userId || org.ownerId,
			deletedAt: null
		});
		await this.loader.write(store);
	}

	async updateOrg(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug'>>
	): Promise<void> {
		const store = await this.loader.get();
		const idx = store.orgs.findIndex((o) => o.id === id && isLive(o));
		if (idx === -1) throw new ProviderError(`Org '${id}' not found`, 404);
		if (patch.slug && patch.slug !== store.orgs[idx].slug) {
			if (store.orgs.some((o) => o.id !== id && o.slug === patch.slug && isLive(o))) {
				throw new ProviderError(`Org slug '${patch.slug}' already in use`, 409);
			}
		}
		store.orgs[idx] = {
			...store.orgs[idx],
			...patch,
			updatedAt: new Date().toISOString(),
			updatedBy: ctx.userId || store.orgs[idx].updatedBy
		};
		await this.loader.write(store);
	}

	async deleteOrg(ctx: RequestContext, id: string): Promise<void> {
		const store = await this.loader.get();
		const idx = store.orgs.findIndex((o) => o.id === id && isLive(o));
		if (idx === -1) throw new ProviderError(`Org '${id}' not found`, 404);
		const now = new Date().toISOString();
		const actor = ctx.userId || store.orgs[idx].updatedBy;
		// Cascade soft-delete into members, projects, and project members.
		store.orgs[idx] = {
			...store.orgs[idx],
			deletedAt: now,
			updatedAt: now,
			updatedBy: actor
		};
		store.orgMembers = store.orgMembers.map((m) =>
			m.orgId === id && isLive(m) ? { ...m, deletedAt: now, updatedAt: now, updatedBy: actor } : m
		);
		const orgProjectIds = new Set(
			store.projects.filter((p) => p.orgId === id && isLive(p)).map((p) => p.id)
		);
		store.projects = store.projects.map((p) =>
			p.orgId === id && isLive(p)
				? { ...p, deletedAt: now, updatedAt: now, updatedBy: actor }
				: p
		);
		store.projectMembers = store.projectMembers.map((m) =>
			orgProjectIds.has(m.projectId) && isLive(m)
				? { ...m, deletedAt: now, updatedAt: now, updatedBy: actor }
				: m
		);
		await this.loader.write(store);
	}

	async listOrgMembers(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<OrgMember>> {
		const { orgMembers } = await this.loader.get();
		return paginate(
			orgMembers.filter((m) => m.orgId === orgId && isLive(m)).map(migrateOrgMember),
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
		return m && isLive(m) ? migrateOrgMember(m) : null;
	}

	async addOrgMember(ctx: RequestContext, member: OrgMember): Promise<void> {
		const store = await this.loader.get();
		const now = new Date().toISOString();
		const actor = ctx.userId || member.userId;
		// Reactivate a prior soft-deleted row rather than piling rows up.
		const existing = store.orgMembers.find(
			(m) => m.orgId === member.orgId && m.userId === member.userId
		);
		if (existing) {
			Object.assign(existing, member, {
				permissions: member.permissions ?? [...DEFAULT_ORG_PERMISSIONS[member.role]],
				updatedAt: now,
				updatedBy: actor,
				deletedAt: null
			});
		} else {
			store.orgMembers.push({
				...member,
				permissions: member.permissions ?? [...DEFAULT_ORG_PERMISSIONS[member.role]],
				updatedAt: member.updatedAt ?? now,
				updatedBy: member.updatedBy ?? actor,
				deletedAt: null
			});
		}
		await this.loader.write(store);
	}

	async updateOrgMemberRole(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void> {
		const store = await this.loader.get();
		const m = store.orgMembers.find(
			(m) => m.orgId === orgId && m.userId === userId && isLive(m)
		);
		if (!m) throw new ProviderError(`Org member '${userId}' not found`, 404);
		m.role = role;
		// Role change re-seeds the permission defaults. To preserve a custom
		// OrgPermission set, call updateOrgMemberPermissions after the role change.
		m.permissions = [...DEFAULT_ORG_PERMISSIONS[role]];
		m.updatedAt = new Date().toISOString();
		m.updatedBy = ctx.userId || m.updatedBy;
		await this.loader.write(store);
	}

	async updateOrgMemberPermissions(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		permissions: readonly OrgPermission[]
	): Promise<void> {
		const store = await this.loader.get();
		const m = store.orgMembers.find(
			(m) => m.orgId === orgId && m.userId === userId && isLive(m)
		);
		if (!m) throw new ProviderError(`Org member '${userId}' not found`, 404);
		m.permissions = sanitizeOrgPermissions(permissions as readonly string[]);
		m.updatedAt = new Date().toISOString();
		m.updatedBy = ctx.userId || m.updatedBy;
		await this.loader.write(store);
	}

	async removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void> {
		const store = await this.loader.get();
		const m = store.orgMembers.find(
			(m) => m.orgId === orgId && m.userId === userId && isLive(m)
		);
		if (!m) return;
		const now = new Date().toISOString();
		const actor = ctx.userId || m.updatedBy;
		m.deletedAt = now;
		m.updatedAt = now;
		m.updatedBy = actor;

		// §9: losing org membership ends every project membership scoped to
		// that tenant. Cascading here keeps the "members ⊂ org members"
		// invariant true by construction so reads don't need to re-check it.
		const projectIdsInOrg = new Set(
			store.projects.filter((p) => p.orgId === orgId).map((p) => p.id)
		);
		store.projectMembers = store.projectMembers.map((pm) =>
			pm.userId === userId && projectIdsInOrg.has(pm.projectId) && isLive(pm)
				? { ...pm, deletedAt: now, updatedAt: now, updatedBy: actor }
				: pm
		);

		await this.loader.write(store);
	}
}
