import * as path from 'node:path';
import type {
	IOrgStore,
	IInviteStore,
	IComputeServerStore,
	IPlatformProjectGrantStore,
	IEventSink,
	Organization,
	OrgRole,
	OrgPermission,
	OrgMember,
	Project,
	ProjectMember,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import {
	DEFAULT_ORG_PERMISSIONS,
	ProviderError,
	auditUpdate,
	auditSoftDelete,
	actorFrom,
	NoopEventSink
} from '@selvajs/platform';
import { paginate, applyOrder } from './pagination.js';
import { readJsonFile, writeJsonFile } from './fsJson.js';
import { LocalInviteStore } from './LocalInviteStore.js';
import { LocalComputeServerStore } from './LocalComputeServerStore.js';
import { LocalPlatformProjectGrantStore } from './LocalPlatformProjectGrantStore.js';

/** Shape of the on-disk local-org.json file. */
export interface LocalOrgStoreData {
	orgs: Organization[];
	projects: Project[];
	orgMembers: OrgMember[];
	projectMembers: ProjectMember[];
}

/** Data-access-layer filter: row is live (not soft-deleted). */
function isLive<T extends { deletedAt?: string | null }>(row: T): boolean {
	return row.deletedAt == null;
}

/**
 * Shared by LocalOrgStore and LocalProjectStore — one instance so all
 * reads/writes go through one cache and one atomic write path.
 *
 * Concurrent first-callers share a single in-flight read promise, so they
 * end up with the same cached object reference; `writeJsonFile`'s
 * temp+rename keeps the on-disk view atomic.
 */
export class LocalOrgStoreLoader {
	readonly storePath: string;
	private store: LocalOrgStoreData | null = null;
	private loading: Promise<LocalOrgStoreData> | null = null;

	constructor(dataPath: string) {
		this.storePath = path.join(dataPath, 'local-org.json');
	}

	async get(): Promise<LocalOrgStoreData> {
		if (this.store) return this.store;
		this.loading ??= readJsonFile<LocalOrgStoreData>(this.storePath, {
			orgs: [],
			projects: [],
			orgMembers: [],
			projectMembers: []
		}).then((data) => {
			this.store = data;
			this.loading = null;
			return data;
		});
		return this.loading;
	}

	async write(store: LocalOrgStoreData): Promise<void> {
		this.store = store;
		await writeJsonFile(this.storePath, store);
	}
}

export interface LocalOrgStoreOptions {
	loader: LocalOrgStoreLoader;
	/**
	 * Sibling stores for the `deleteOrg` cascade — invites, compute config, and
	 * grants live in separate JSON files the loader can't reach. Required, not
	 * optional: an unwired cascade silently leaks operational data.
	 */
	invites: IInviteStore;
	computeServer: IComputeServerStore;
	grants: IPlatformProjectGrantStore;
	events?: IEventSink;
}

export class LocalOrgStore implements IOrgStore {
	private readonly loader: LocalOrgStoreLoader;
	private readonly events: IEventSink;
	private readonly invites: IInviteStore;
	private readonly computeServer: IComputeServerStore;
	private readonly grants: IPlatformProjectGrantStore;

	static fromEnv(env: Record<string, string | undefined>): LocalOrgStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalOrgStore({
			loader: new LocalOrgStoreLoader(env.DATA_PATH),
			invites: LocalInviteStore.fromEnv(env),
			computeServer: LocalComputeServerStore.fromEnv(env),
			grants: LocalPlatformProjectGrantStore.fromEnv(env)
		});
	}

	constructor(opts: LocalOrgStoreOptions) {
		this.loader = opts.loader;
		this.invites = opts.invites;
		this.computeServer = opts.computeServer;
		this.grants = opts.grants;
		this.events = opts.events ?? new NoopEventSink();
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
			...auditUpdate(ctx, org.ownerId),
			deletedAt: null
		});
		await this.loader.write(store);
		await this.events.emit({ type: 'org.created', orgId: org.id, actorId: actorFrom(ctx) });
	}

	async updateOrg(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug' | 'assets'>>
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
			...auditUpdate(ctx, store.orgs[idx].updatedBy ?? store.orgs[idx].ownerId)
		};
		await this.loader.write(store);
	}

	async deleteOrg(ctx: RequestContext, id: string): Promise<void> {
		const store = await this.loader.get();
		const idx = store.orgs.findIndex((o) => o.id === id && isLive(o));
		if (idx === -1) throw new ProviderError(`Org '${id}' not found`, 404);
		const stamp = auditSoftDelete(ctx, store.orgs[idx].updatedBy ?? store.orgs[idx].ownerId);
		store.orgs[idx] = { ...store.orgs[idx], ...stamp };
		store.orgMembers = store.orgMembers.map((m) =>
			m.orgId === id && isLive(m) ? { ...m, ...stamp } : m
		);
		const orgProjectIds = new Set(
			store.projects.filter((p) => p.orgId === id && isLive(p)).map((p) => p.id)
		);
		store.projects = store.projects.map((p) =>
			p.orgId === id && isLive(p) ? { ...p, ...stamp } : p
		);
		store.projectMembers = store.projectMembers.map((m) =>
			orgProjectIds.has(m.projectId) && isLive(m) ? { ...m, ...stamp } : m
		);
		await this.loader.write(store);
		// Invites and compute config are operational, not user data, so they
		// hard-delete rather than soft-delete — no audit trail to preserve.
		await this.invites.deleteByOrg(ctx, id);
		await this.computeServer.deleteByOrg(ctx, id);
		// User grants survive — they're identity-scoped, not org-scoped.
		for (const projectId of orgProjectIds) {
			await this.grants.deleteByProject(ctx, projectId);
		}
		await this.grants.deleteByGranteeOrg(ctx, id);
		await this.events.emit({ type: 'org.deleted', orgId: id, actorId: actorFrom(ctx) });
	}

	async listOrgMembers(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<OrgMember>> {
		const { orgMembers } = await this.loader.get();
		return paginate(
			orgMembers.filter((m) => m.orgId === orgId && isLive(m)),
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
		return m && isLive(m) ? m : null;
	}

	async getOrgMembersFor(
		_ctx: RequestContext,
		orgIds: readonly string[],
		userId: string
	): Promise<Map<string, OrgMember | null>> {
		const { orgMembers } = await this.loader.get();
		const byOrgId = new Map(
			orgMembers.filter((m) => m.userId === userId && isLive(m)).map((m) => [m.orgId, m])
		);
		return new Map(orgIds.map((id) => [id, byOrgId.get(id) ?? null]));
	}

	async findUserMembership(
		_ctx: RequestContext,
		userId: string
	): Promise<{ org: Organization; member: OrgMember } | null> {
		// Picks the first live membership; ordering follows insertion order in
		// the JSON file, stable across reads.
		const store = await this.loader.get();
		const member = store.orgMembers.find((m) => m.userId === userId && isLive(m));
		if (!member) return null;
		const org = store.orgs.find((o) => o.id === member.orgId);
		// A membership pointing at a soft-deleted org counts as gone, same as the
		// SQL adapter gets via FK + RLS on `orgs.deleted_at`.
		if (!org || !isLive(org)) return null;
		return { org, member };
	}

	async addOrgMember(ctx: RequestContext, member: OrgMember): Promise<void> {
		const store = await this.loader.get();
		// Reactivate a prior soft-deleted row rather than piling rows up.
		const existing = store.orgMembers.find(
			(m) => m.orgId === member.orgId && m.userId === member.userId
		);
		if (existing) {
			Object.assign(existing, member, {
				...auditUpdate(ctx, member.userId),
				deletedAt: null
			});
		} else {
			store.orgMembers.push({ ...member, deletedAt: null });
		}
		await this.loader.write(store);
		await this.events.emit({
			type: 'org_member.added',
			orgId: member.orgId,
			userId: member.userId,
			actorId: actorFrom(ctx)
		});
	}

	async updateOrgMemberRole(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void> {
		const store = await this.loader.get();
		const m = store.orgMembers.find((m) => m.orgId === orgId && m.userId === userId && isLive(m));
		if (!m) throw new ProviderError(`Org member '${userId}' not found`, 404);
		m.role = role;
		// Resets permissions to the role's defaults. To keep a custom set, call
		// updateOrgMemberPermissions after this.
		m.permissions = [...DEFAULT_ORG_PERMISSIONS[role]];
		Object.assign(m, auditUpdate(ctx, m.updatedBy));
		await this.loader.write(store);
		await this.events.emit({
			type: 'org_member.role_changed',
			orgId,
			userId,
			role,
			actorId: actorFrom(ctx)
		});
	}

	async updateOrgMemberPermissions(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		permissions: readonly OrgPermission[]
	): Promise<void> {
		const store = await this.loader.get();
		const m = store.orgMembers.find((m) => m.orgId === orgId && m.userId === userId && isLive(m));
		if (!m) throw new ProviderError(`Org member '${userId}' not found`, 404);
		m.permissions = [...permissions];
		Object.assign(m, auditUpdate(ctx, m.updatedBy));
		await this.loader.write(store);
		await this.events.emit({
			type: 'org_member.permissions_changed',
			orgId,
			userId,
			permissions: [...permissions],
			actorId: actorFrom(ctx)
		});
	}

	async removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void> {
		const store = await this.loader.get();
		const m = store.orgMembers.find((m) => m.orgId === orgId && m.userId === userId && isLive(m));
		if (!m) return;
		const stamp = auditSoftDelete(ctx, m.updatedBy);
		Object.assign(m, stamp);

		// Losing org membership ends every project membership in that org, so
		// "members ⊂ org members" stays true without reads having to re-check it.
		const projectIdsInOrg = new Set(
			store.projects.filter((p) => p.orgId === orgId).map((p) => p.id)
		);
		store.projectMembers = store.projectMembers.map((pm) =>
			pm.userId === userId && projectIdsInOrg.has(pm.projectId) && isLive(pm)
				? { ...pm, ...stamp }
				: pm
		);

		await this.loader.write(store);
		await this.events.emit({
			type: 'org_member.removed',
			orgId,
			userId,
			actorId: actorFrom(ctx)
		});
	}
}
