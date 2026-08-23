import type {
	IShareLinkStore,
	IEventSink,
	OrgShareLink,
	ShareLink,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import { actorFrom, NoopEventSink } from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';
import { nextCursorFromRange, toRange } from './pagination.js';

/** Explicit column list for `share_links` — every field `rowToLink` consumes. */
const SHARE_LINK_COLUMNS =
	'id, definition_guid, channel, token_hash, name, created_by, created_at, expires_at, revoked_at, allow_solve, max_solves, solve_count';

/**
 * Share-link store backed by Postgres.
 *
 * `getByTokenHash` and `tryIncrementSolveCount` go through the service-role
 * client and a SECURITY DEFINER RPC, bypassing RLS: the token itself is the
 * credential, not the authenticated user's identity.
 *
 * Reads filter `revoked_at` AND `expires_at` — a dead link must read dead
 * through the store, not only wherever a route remembers to re-check the date.
 * `try_increment_share_link_solve_count` already enforces both server-side.
 */
export class SupabaseShareLinkStore implements IShareLinkStore {
	private readonly events: IEventSink;

	constructor(
		private readonly clients: ClientBundle,
		events: IEventSink = new NoopEventSink()
	) {
		this.events = events;
	}

	async create(ctx: RequestContext, link: ShareLink): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('share_links')
			.insert(linkToRow(link));
		if (error) throw mapPostgrestError(error);
		await this.events.emit({
			type: 'share_link.minted',
			linkId: link.id,
			definitionId: link.definitionId,
			actorId: actorFrom(ctx)
		});
	}

	async listByDefinition(
		ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<ShareLink>> {
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('share_links')
			.select(SHARE_LINK_COLUMNS, { count: 'exact' })
			.eq('definition_guid', definitionId)
			.is('revoked_at', null)
			.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
			.order('created_at', { ascending: false })
			.range(range.from, range.to);
		if (error) throw mapPostgrestError(error);
		const items = (data ?? []).map(rowToLink);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async listByOrg(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<OrgShareLink>> {
		// `!inner` makes the embeds a filtering join, so `projects.org_id` scopes
		// the whole query — links whose definition or project is soft-deleted drop
		// out for free. RLS narrows this further to orgs the caller leads.
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('share_links')
			.select(
				`${SHARE_LINK_COLUMNS}, definitions!inner(display_name, deleted_at, projects!inner(id, name, org_id, deleted_at))`,
				{ count: 'exact' }
			)
			.is('revoked_at', null)
			.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
			.is('definitions.deleted_at', null)
			.is('definitions.projects.deleted_at', null)
			.eq('definitions.projects.org_id', orgId)
			.order('created_at', { ascending: false })
			.range(range.from, range.to);
		if (error) throw mapPostgrestError(error);
		const items = (data ?? []).map((row) => rowToOrgLink(row as unknown as OrgShareLinkRow));
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getById(ctx: RequestContext, id: string): Promise<ShareLink | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('share_links')
			.select(SHARE_LINK_COLUMNS)
			.eq('id', id)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToLink(data) : null;
	}

	async getByTokenHash(_ctx: RequestContext, tokenHash: string): Promise<ShareLink | null> {
		// Service-role: RLS would scope this to "links the current user can see",
		// but an anonymous caller resolving a token has no user to scope to.
		const { data, error } = await this.clients.serviceClient
			.from('share_links')
			.select(`${SHARE_LINK_COLUMNS}, definitions!inner(deleted_at)`)
			.eq('token_hash', tokenHash)
			.is('revoked_at', null)
			.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
			.is('definitions.deleted_at', null)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToLink(data) : null;
	}

	async revoke(ctx: RequestContext, id: string): Promise<void> {
		// `.is('revoked_at', null)` makes a re-revoke a no-op instead of an error.
		const { error } = await this.clients
			.forRequest(ctx)
			.from('share_links')
			.update({ revoked_at: new Date().toISOString() })
			.eq('id', id)
			.is('revoked_at', null);
		if (error) throw mapPostgrestError(error);
		await this.events.emit({ type: 'share_link.revoked', linkId: id, actorId: actorFrom(ctx) });
	}

	async tryIncrementSolveCount(_ctx: RequestContext, id: string): Promise<number | null> {
		// Atomic check-and-increment in one RPC call: returns null if the link is
		// missing/revoked/expired/capped, so concurrent solves can't overshoot max_solves.
		const { data, error } = await this.clients.serviceClient.rpc(
			'try_increment_share_link_solve_count',
			{ link_id: id }
		);
		if (error) throw mapPostgrestError(error);
		return typeof data === 'number' ? data : null;
	}
}

// ============================================================================
// Row ↔ domain mappers
// ============================================================================
interface ShareLinkRow {
	id: string;
	definition_guid: string;
	channel: 'live' | 'draft';
	token_hash: string;
	name: string | null;
	created_by: string;
	created_at: string;
	expires_at: string | null;
	revoked_at: string | null;
	allow_solve: boolean;
	max_solves: number | null;
	solve_count: number;
}

/**
 * `listByOrg`'s row. PostgREST returns an embed as an object for a to-one
 * relationship and an array for to-many; both shapes are accepted because the
 * choice depends on how it infers the FK, not on anything this store controls.
 */
interface OrgShareLinkRow extends ShareLinkRow {
	definitions:
		| { display_name: string; projects: ProjectEmbed | ProjectEmbed[] }
		| { display_name: string; projects: ProjectEmbed | ProjectEmbed[] }[];
}

interface ProjectEmbed {
	id: string;
	name: string;
}

function one<T>(embed: T | T[]): T {
	return Array.isArray(embed) ? embed[0] : embed;
}

function rowToOrgLink(row: OrgShareLinkRow): OrgShareLink {
	const definition = one(row.definitions);
	const project = one(definition.projects);
	// `tokenHash` is dropped rather than carried: this row is built for a page
	// spanning every definition in the tenant.
	const { tokenHash: _tokenHash, ...rest } = rowToLink(row);
	return {
		...rest,
		definitionName: definition.display_name,
		projectId: project.id,
		projectName: project.name
	};
}

function rowToLink(row: ShareLinkRow): ShareLink {
	return {
		id: row.id,
		definitionId: row.definition_guid,
		channel: row.channel,
		tokenHash: row.token_hash,
		name: row.name ?? undefined,
		createdBy: row.created_by,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
		allowSolve: row.allow_solve,
		maxSolves: row.max_solves,
		solveCount: row.solve_count
	};
}

function linkToRow(l: ShareLink): Record<string, unknown> {
	return {
		id: l.id,
		definition_guid: l.definitionId,
		channel: l.channel,
		token_hash: l.tokenHash,
		name: l.name ?? null,
		created_by: l.createdBy,
		created_at: l.createdAt,
		expires_at: l.expiresAt ?? null,
		revoked_at: l.revokedAt ?? null,
		allow_solve: l.allowSolve,
		max_solves: l.maxSolves ?? null,
		solve_count: l.solveCount
	};
}
