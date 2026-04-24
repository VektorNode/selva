import type {
	IOrgStore,
	Organization,
	OrgMember,
	OrgRole,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { DEFAULT_ORG_PERMISSIONS, ProviderError } from '@selva/platform';
import type { ClientBundle } from './client.js';
import { nextCursorFromRange, orderColumn, toRange } from './pagination.js';

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
	constructor(private readonly clients: ClientBundle) {}

	async listOrgs(ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>> {
		const range = toRange(opts);
		const direction = opts?.orderDir ?? 'desc';
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.select('*', { count: 'exact' })
			.order(orderColumn(opts?.orderBy), { ascending: direction === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapError(error);
		const items = (data ?? []).map(rowToOrg);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getOrg(ctx: RequestContext, id: string): Promise<Organization | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToOrg(data) : null;
	}

	async getOrgBySlug(ctx: RequestContext, slug: string): Promise<Organization | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.select('*')
			.eq('slug', slug)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToOrg(data) : null;
	}

	async createOrg(ctx: RequestContext, org: Organization): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const { error } = await client.from('orgs').insert(orgToRow(org));
		if (error) throw mapError(error);

		// Seed owner membership so user-scoped queries can see the org post-create.
		// Service-role bypasses RLS, but the same code path runs for user-scoped
		// callers — the membership row is what makes them visible to themselves.
		const { error: memberError } = await client.from('org_members').insert({
			org_id: org.id,
			user_id: org.ownerId,
			role: 'owner',
			permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
			joined_at: new Date().toISOString()
		});
		// Ignore duplicate-key — the app may pre-seed. Surface anything else.
		if (memberError && !isUniqueViolation(memberError)) throw mapError(memberError);
	}

	async updateOrg(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug'>>
	): Promise<void> {
		const row: Record<string, unknown> = {};
		if (patch.name !== undefined) row.name = patch.name;
		if (patch.slug !== undefined) row.slug = patch.slug;
		if (Object.keys(row).length === 0) return;

		const { error, data } = await this.clients
			.forRequest(ctx)
			.from('orgs')
			.update(row)
			.eq('id', id)
			.select('id');
		if (error) throw mapError(error);
		if (!data || data.length === 0) throw new ProviderError(`Org '${id}' not found`, 404);
	}

	async deleteOrg(ctx: RequestContext, id: string): Promise<void> {
		const { error } = await this.clients.forRequest(ctx).from('orgs').delete().eq('id', id);
		if (error) throw mapError(error);
	}

	// ── Org members ──────────────────────────────────────────────────────────

	async listOrgMembers(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<OrgMember>> {
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.select('*', { count: 'exact' })
			.eq('org_id', orgId)
			.order('joined_at', { ascending: (opts?.orderDir ?? 'desc') === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapError(error);
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
			.select('*')
			.eq('org_id', orgId)
			.eq('user_id', userId)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToOrgMember(data) : null;
	}

	async addOrgMember(ctx: RequestContext, member: OrgMember): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.insert(memberToRow(member));
		if (error) throw mapError(error);
	}

	async updateOrgMemberRole(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void> {
		// Role change re-seeds default permissions. Matches LocalOrganizationProvider.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.update({ role, permissions: [...DEFAULT_ORG_PERMISSIONS[role]] })
			.eq('org_id', orgId)
			.eq('user_id', userId)
			.select('user_id');
		if (error) throw mapError(error);
		if (!data || data.length === 0)
			throw new ProviderError(`Org member '${userId}' not found`, 404);
	}

	async removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('org_members')
			.delete()
			.eq('org_id', orgId)
			.eq('user_id', userId);
		if (error) throw mapError(error);
	}
}

// ── Row ↔ domain mappers ────────────────────────────────────────────────

interface OrgRow {
	id: string;
	name: string;
	slug: string;
	owner_id: string;
	created_at: string;
	updated_at: string;
}

interface OrgMemberRow {
	org_id: string;
	user_id: string;
	role: OrgRole;
	permissions: string[];
	joined_at: string;
}

function rowToOrg(row: OrgRow): Organization {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		ownerId: row.owner_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function orgToRow(org: Organization): OrgRow {
	return {
		id: org.id,
		name: org.name,
		slug: org.slug,
		owner_id: org.ownerId,
		created_at: org.createdAt,
		updated_at: org.updatedAt
	};
}

function rowToOrgMember(row: OrgMemberRow): OrgMember {
	return {
		orgId: row.org_id,
		userId: row.user_id,
		role: row.role,
		permissions: (row.permissions ?? []) as OrgMember['permissions'],
		joinedAt: row.joined_at
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

// ── Error translation ───────────────────────────────────────────────────

interface PostgrestError {
	code?: string;
	message?: string;
	details?: string;
}

function isUniqueViolation(e: unknown): boolean {
	return Boolean(e && typeof e === 'object' && (e as PostgrestError).code === '23505');
}

function mapError(e: unknown): Error {
	const pg = e as PostgrestError;
	if (pg?.code === '23505') {
		return new ProviderError(pg.message ?? 'Duplicate record', 409);
	}
	if (pg?.code === '23503') {
		return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	}
	return e instanceof Error ? e : new Error(String(e));
}
