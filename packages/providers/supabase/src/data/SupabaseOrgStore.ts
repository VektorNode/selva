import type {
	IOrgStore,
	IEventSink,
	Organization,
	OrgMember,
	OrgRole,
	OrgPermission,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import {
	DEFAULT_ORG_PERMISSIONS,
	ProviderError,
	actorFrom,
	NoopEventSink
} from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';
import { nextCursorFromRange, orderColumn, toRange } from './pagination.js';
import { stampSoftDelete, stampUpdate } from './rowStamp.js';

/** Explicit column list for `orgs` — every field `rowToOrg` consumes. */
const ORG_COLUMNS =
	'id, name, slug, owner_id, assets, created_by, updated_by, created_at, updated_at, deleted_at';
/** Explicit column list for `org_members` — every field `rowToOrgMember` consumes. */
const ORG_MEMBER_COLUMNS =
	'org_id, user_id, role, permissions, joined_at, updated_at, updated_by, deleted_at';

/**
 * Org + org-membership store backed by Postgres. The queries rely on RLS
 * for per-user visibility; the service-role client bypasses those policies
 * for admin paths (setup, janitor, tests).
 *
 * `createOrg` atomically seeds the creator as `owner` with every
 * `OrgPermission` — otherwise under user-scoped RLS the creator would
 * immediately lose visibility of their own org.
 */
export class SupabaseOrgStore implements IOrgStore {
	private readonly events: IEventSink;

	constructor(
		private readonly clients: ClientBundle,
		events: IEventSink = new NoopEventSink()
	) {
		this.events = events;
	}

	async listOrgs(ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>> {
		const range = toRange(opts);
		const direction = opts?.orderDir ?? 'desc';
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.select(ORG_COLUMNS, { count: 'exact' })
			.is('deleted_at', null)
			.order(orderColumn(opts?.orderBy), { ascending: direction === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapPostgrestError(error);
		const items = (data ?? []).map(rowToOrg);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getOrg(ctx: RequestContext, id: string): Promise<Organization | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.select(ORG_COLUMNS)
			.eq('id', id)
			.is('deleted_at', null)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToOrg(data) : null;
	}

	async getOrgBySlug(ctx: RequestContext, slug: string): Promise<Organization | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.select(ORG_COLUMNS)
			.eq('slug', slug)
			.is('deleted_at', null)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToOrg(data) : null;
	}

	async createOrg(ctx: RequestContext, org: Organization): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const { error } = await client.from('orgs').insert(orgToRow(org));
		if (error) throw mapPostgrestError(error);

		// Seed owner membership so user-scoped queries can see the org post-create.
		// Service-role bypasses RLS, but the same code path runs for user-scoped
		// callers — the membership row is what makes them visible to themselves.
		// Upsert so a stale soft-deleted row from a prior org with the same id
		// is reactivated rather than blocking creation.
		const { error: memberError } = await client.from('org_members').upsert(
			{
				org_id: org.id,
				user_id: org.ownerId,
				role: 'owner',
				permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
				joined_at: new Date().toISOString(),
				deleted_at: null
			},
			{ onConflict: 'org_id,user_id' }
		);
		if (memberError) throw mapPostgrestError(memberError);
		await this.events.emit({ type: 'org.created', orgId: org.id, actorId: actorFrom(ctx) });
	}

	async updateOrg(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug' | 'assets'>>
	): Promise<void> {
		const row: Record<string, unknown> = {};
		if (patch.name !== undefined) row.name = patch.name;
		if (patch.slug !== undefined) row.slug = patch.slug;
		// Callers pass the full merged map; store it wholesale (JSONB column).
		if (patch.assets !== undefined) row.assets = patch.assets;
		if (Object.keys(row).length === 0) return;
		// `updated_at` is set by the trg_orgs_updated_at trigger; `stampUpdate`
		// only adds `updated_by`, and only when ctx.userId is set (empty on
		// system contexts would violate the `on delete set null` FK).
		Object.assign(row, stampUpdate(ctx));

		const { error, data } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.update(row)
			.eq('id', id)
			.is('deleted_at', null)
			.select('id');
		if (error) throw mapPostgrestError(error);
		if (!data || data.length === 0) throw new ProviderError(`Org '${id}' not found`, 404);
	}

	async deleteOrg(ctx: RequestContext, id: string): Promise<void> {
		// §9 soft-delete with cascade. Mirrors LocalOrgStore: org → org_members,
		// projects → project_members, definitions. Hard delete is reserved for
		// the background janitor; user-facing deletes preserve the audit trail.
		const client = this.clients.forRequest(ctx);
		const stampRow = stampSoftDelete(ctx);

		// Org itself.
		const { error: orgErr, data: orgData } = await client
			.from('orgs')
			.update(stampRow)
			.eq('id', id)
			.is('deleted_at', null)
			.select('id');
		if (orgErr) throw mapPostgrestError(orgErr);
		if (!orgData || orgData.length === 0) throw new ProviderError(`Org '${id}' not found`, 404);

		// Cascade: org_members.
		const { error: omErr } = await client
			.from('org_members')
			.update(stampRow)
			.eq('org_id', id)
			.is('deleted_at', null);
		if (omErr) throw mapPostgrestError(omErr);

		// Cascade: projects in this org. Fetch IDs first so we can cascade to
		// project_members and definitions in app code (Postgres FK CASCADE only
		// fires on hard DELETE, which we're not doing here).
		const { data: orgProjects, error: projFetchErr } = await client
			.from('projects')
			.select('id')
			.eq('org_id', id)
			.is('deleted_at', null);
		if (projFetchErr) throw mapPostgrestError(projFetchErr);
		const projectIds = (orgProjects ?? []).map((p) => p.id as string);

		const { error: projErr } = await client
			.from('projects')
			.update(stampRow)
			.eq('org_id', id)
			.is('deleted_at', null);
		if (projErr) throw mapPostgrestError(projErr);

		if (projectIds.length > 0) {
			const { error: pmErr } = await client
				.from('project_members')
				.update(stampRow)
				.in('project_id', projectIds)
				.is('deleted_at', null);
			if (pmErr) throw mapPostgrestError(pmErr);

			const { error: defErr } = await client
				.from('definitions')
				.update(stampRow)
				.in('project_id', projectIds)
				.is('deleted_at', null);
			if (defErr) throw mapPostgrestError(defErr);
		}

		// Hard-delete tables that have no `deleted_at` column. SQL CASCADE on
		// the org FK only fires for hard org deletes; we soft-delete, so we
		// clean these up here. Pending invites to a dead org are unredeemable;
		// stale compute config is operational state with no audit need.
		const { error: invErr } = await client.from('invites').delete().eq('org_id', id);
		if (invErr) throw mapPostgrestError(invErr);

		const { error: cdErr } = await client
			.from('compute_server_org_defaults')
			.delete()
			.eq('org_id', id);
		if (cdErr) throw mapPostgrestError(cdErr);

		const { error: shErr } = await client.from('compute_server_shares').delete().eq('org_id', id);
		if (shErr) throw mapPostgrestError(shErr);

		const { error: csErr } = await client
			.from('compute_servers')
			.delete()
			.eq('scope', 'org')
			.eq('owner_org_id', id);
		if (csErr) throw mapPostgrestError(csErr);

		await this.events.emit({ type: 'org.deleted', orgId: id, actorId: actorFrom(ctx) });
	}

	// ============================================================================
	// Org members
	// ============================================================================
	async listOrgMembers(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<OrgMember>> {
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.select(ORG_MEMBER_COLUMNS, { count: 'exact' })
			.eq('org_id', orgId)
			.is('deleted_at', null)
			.order('joined_at', { ascending: (opts?.orderDir ?? 'desc') === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapPostgrestError(error);
		const items = (data ?? []).map(rowToOrgMember);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getOrgMember(
		ctx: RequestContext,
		orgId: string,
		userId: string
	): Promise<OrgMember | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.select(ORG_MEMBER_COLUMNS)
			.eq('org_id', orgId)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToOrgMember(data) : null;
	}

	async findUserMembership(
		ctx: RequestContext,
		userId: string
	): Promise<{ org: Organization; member: OrgMember } | null> {
		// One round-trip: join org_members → orgs and filter live rows on
		// both sides. PostgREST `!inner` on the join keeps it a single SELECT,
		// avoiding the listOrgs + getOrgMember-per-org N+1 the bootstrap path
		// used to do. RLS still scopes by ctx; service-role sees all.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.select(`${ORG_MEMBER_COLUMNS}, org:orgs!inner(${ORG_COLUMNS})`)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.is('org.deleted_at', null)
			.order('joined_at', { ascending: true })
			.limit(1)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		if (!data) return null;

		// PostgREST embeds the related row as `org` per the alias above. Strip
		// it off the member row before mapping so OrgMember stays clean.
		const row = data as OrgMemberRow & { org: OrgRow | OrgRow[] };
		const orgRow = Array.isArray(row.org) ? row.org[0] : row.org;
		if (!orgRow) return null;
		const { org: _omit, ...memberRow } = row;
		return {
			org: rowToOrg(orgRow),
			member: rowToOrgMember(memberRow as OrgMemberRow)
		};
	}

	async addOrgMember(ctx: RequestContext, member: OrgMember): Promise<void> {
		// Upsert so a prior soft-deleted row is reactivated rather than throwing
		// a duplicate-key error. Mirrors LocalOrgStore.addOrgMember.
		const row: Record<string, unknown> = {
			...memberToRow(member),
			deleted_at: null,
			...stampUpdate(ctx)
		};
		const { error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.upsert(row, { onConflict: 'org_id,user_id' });
		if (error) throw mapPostgrestError(error);
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
		// Role change re-seeds default permissions. Matches LocalOrgStore.
		const row: Record<string, unknown> = {
			role,
			permissions: [...DEFAULT_ORG_PERMISSIONS[role]],
			...stampUpdate(ctx)
		};
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.update(row)
			.eq('org_id', orgId)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.select('user_id');
		if (error) throw mapPostgrestError(error);
		if (!data || data.length === 0)
			throw new ProviderError(`Org member '${userId}' not found`, 404);
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
		// Replace permissions only. Matches LocalOrgStore.updateOrgMemberPermissions —
		// distinct from role change so callers can grant a finer-grained set without
		// re-seeding defaults from the role.
		const row: Record<string, unknown> = { permissions: [...permissions], ...stampUpdate(ctx) };
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.update(row)
			.eq('org_id', orgId)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.select('user_id');
		if (error) throw mapPostgrestError(error);
		if (!data || data.length === 0)
			throw new ProviderError(`Org member '${userId}' not found`, 404);
		await this.events.emit({
			type: 'org_member.permissions_changed',
			orgId,
			userId,
			permissions: [...permissions],
			actorId: actorFrom(ctx)
		});
	}

	async removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void> {
		// §9 cascade — losing org membership ends every project membership scoped
		// to that tenant. Soft-delete the org_member row, then cascade-soft-delete
		// the user's project_members for any project in this org. Run the project
		// cascade BEFORE the org_member update so RLS policies that gate
		// project_members on org_member existence still pass for the duration.
		const client = this.clients.forRequest(ctx);
		const stampRow = stampSoftDelete(ctx);

		const { data: orgProjects, error: projError } = await client
			.from('projects')
			.select('id')
			.eq('org_id', orgId)
			.is('deleted_at', null);
		if (projError) throw mapPostgrestError(projError);

		const projectIds = (orgProjects ?? []).map((p) => p.id as string);
		if (projectIds.length > 0) {
			const { error: pmError } = await client
				.from('project_members')
				.update(stampRow)
				.in('project_id', projectIds)
				.eq('user_id', userId)
				.is('deleted_at', null);
			if (pmError) throw mapPostgrestError(pmError);
		}

		const { error } = await client
			.from('org_members')
			.update(stampRow)
			.eq('org_id', orgId)
			.eq('user_id', userId)
			.is('deleted_at', null);
		if (error) throw mapPostgrestError(error);
		await this.events.emit({
			type: 'org_member.removed',
			orgId,
			userId,
			actorId: actorFrom(ctx)
		});
	}
}

// ============================================================================
// Row ↔ domain mappers
// ============================================================================
//
// Audit columns (`created_by` / `updated_by`) FK to `auth.users(id)` with
// `ON DELETE SET NULL`, so they can legitimately become NULL when the
// referenced user is deleted (spec §8). Mappers fall back to `owner_id` /
// `user_id` so the domain type stays non-nullable; UIs that care about
// creator-vs-owner attribution should render "Deleted user" at that layer.

interface OrgRow {
	id: string;
	name: string;
	slug: string;
	owner_id: string;
	assets?: Record<string, string> | null;
	created_by?: string | null;
	updated_by?: string | null;
	created_at: string;
	updated_at: string;
	deleted_at?: string | null;
}

interface OrgMemberRow {
	org_id: string;
	user_id: string;
	role: OrgRole;
	permissions: string[];
	joined_at: string;
	updated_at?: string | null;
	updated_by?: string | null;
	deleted_at?: string | null;
}

function rowToOrg(row: OrgRow): Organization {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		ownerId: row.owner_id,
		assets: row.assets ?? undefined,
		createdBy: row.created_by ?? row.owner_id,
		updatedBy: row.updated_by ?? row.owner_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at ?? null
	};
}

function orgToRow(org: Organization): OrgRow {
	return {
		id: org.id,
		name: org.name,
		slug: org.slug,
		owner_id: org.ownerId,
		assets: org.assets ?? null,
		created_by: org.createdBy,
		updated_by: org.updatedBy,
		created_at: org.createdAt,
		updated_at: org.updatedAt,
		deleted_at: org.deletedAt ?? null
	};
}

function rowToOrgMember(row: OrgMemberRow): OrgMember {
	return {
		orgId: row.org_id,
		userId: row.user_id,
		role: row.role,
		permissions: (row.permissions ?? []) as OrgMember['permissions'],
		joinedAt: row.joined_at,
		updatedAt: row.updated_at ?? row.joined_at,
		updatedBy: row.updated_by ?? row.user_id,
		deletedAt: row.deleted_at ?? null
	};
}

function memberToRow(m: OrgMember): OrgMemberRow {
	return {
		org_id: m.orgId,
		user_id: m.userId,
		role: m.role,
		permissions: m.permissions ?? [],
		joined_at: m.joinedAt
	};
}
