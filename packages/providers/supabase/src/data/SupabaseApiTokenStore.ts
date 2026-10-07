import type {
	ApiToken,
	ApiTokenRevokeReason,
	ApiTokenSummary,
	IApiTokenStore,
	IEventSink,
	ListOptions,
	Page,
	RequestContext
} from '@selvajs/platform';
import { NoopEventSink, actorOf } from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';
import { nextCursorFromRange, toRange } from './pagination.js';

/** Every column a session may read: the hash is granted to service role only. */
const SUMMARY_COLUMNS =
	'id, user_id, created_by, org_id, name, scopes, created_at, expires_at, last_used_at, revoked_at';

/**
 * API token store. `getByTokenHash` and `touchLastUsed` are called with
 * `SYSTEM_CONTEXT`, so they run as service role. Every other call runs under
 * the caller's session, and RLS limits it to their own keys plus, for
 * `manage_org_members`, the org's roster.
 */
export class SupabaseApiTokenStore implements IApiTokenStore {
	constructor(
		private readonly clients: ClientBundle,
		private readonly events: IEventSink = new NoopEventSink()
	) {}

	async create(ctx: RequestContext, token: ApiToken): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.insert(tokenToRow(token));
		if (error) throw mapPostgrestError(error);
		await this.events.emit({
			type: 'api_token.created',
			apiTokenId: token.id,
			orgId: token.orgId,
			userId: token.userId,
			...actorOf(ctx)
		});
	}

	async getByTokenHash(ctx: RequestContext, tokenHash: string): Promise<ApiToken | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.select(`${SUMMARY_COLUMNS}, token_hash`)
			.eq('token_hash', tokenHash)
			.is('revoked_at', null)
			.gt('expires_at', new Date().toISOString())
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToToken(data as ApiTokenRow) : null;
	}

	async get(ctx: RequestContext, id: string): Promise<ApiTokenSummary | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.select(SUMMARY_COLUMNS)
			.eq('id', id)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToSummary(data as SummaryRow) : null;
	}

	async listByOrg(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions & { userId?: string }
	): Promise<Page<ApiTokenSummary>> {
		const range = toRange(opts);
		let query = this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.select(SUMMARY_COLUMNS, { count: 'exact' })
			.eq('org_id', orgId);
		if (opts?.userId) query = query.eq('user_id', opts.userId);
		const { data, error, count } = await query
			.order('created_at', { ascending: (opts?.orderDir ?? 'desc') === 'asc' })
			.order('id')
			.range(range.from, range.to);
		if (error) throw mapPostgrestError(error);
		const items = ((data ?? []) as SummaryRow[]).map(rowToSummary);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async revoke(ctx: RequestContext, id: string, reason: ApiTokenRevokeReason): Promise<void> {
		// `.is('revoked_at', null)` keeps the first revocation time and makes a repeat a no-op.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.update({ revoked_at: new Date().toISOString() })
			.eq('id', id)
			.is('revoked_at', null)
			.select('id, org_id');
		if (error) throw mapPostgrestError(error);
		for (const row of (data ?? []) as RevokedRow[]) await this.emitRevoked(ctx, row, reason);
	}

	async revokeAllForUser(
		ctx: RequestContext,
		userId: string,
		opts: { orgId?: string; reason: ApiTokenRevokeReason }
	): Promise<string[]> {
		let query = this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.update({ revoked_at: new Date().toISOString() })
			.eq('user_id', userId)
			.is('revoked_at', null);
		if (opts.orgId) query = query.eq('org_id', opts.orgId);
		const { data, error } = await query.select('id, org_id');
		if (error) throw mapPostgrestError(error);
		const rows = (data ?? []) as RevokedRow[];
		for (const row of rows) await this.emitRevoked(ctx, row, opts.reason);
		return rows.map((r) => r.id);
	}

	async touchLastUsed(ctx: RequestContext, id: string, at: string): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.update({ last_used_at: at })
			.eq('id', id);
		if (error) throw mapPostgrestError(error);
	}

	/**
	 * Deleting the auth user does this through the FKs already. This covers a
	 * caller erasing the rows before (or without) deleting the identity.
	 */
	async eraseUser(_ctx: RequestContext, userId: string): Promise<void> {
		const client = this.clients.serviceClient;
		const deleted = await client.from('api_tokens').delete().eq('user_id', userId);
		if (deleted.error) throw mapPostgrestError(deleted.error);
		const cleared = await client
			.from('api_tokens')
			.update({ created_by: null })
			.eq('created_by', userId);
		if (cleared.error) throw mapPostgrestError(cleared.error);
	}

	async deleteByOrg(ctx: RequestContext, orgId: string): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('api_tokens')
			.delete()
			.eq('org_id', orgId);
		if (error) throw mapPostgrestError(error);
	}

	private emitRevoked(
		ctx: RequestContext,
		row: RevokedRow,
		reason: ApiTokenRevokeReason
	): Promise<void> {
		return this.events.emit({
			type: 'api_token.revoked',
			apiTokenId: row.id,
			orgId: row.org_id,
			reason,
			...actorOf(ctx)
		});
	}
}

interface SummaryRow {
	id: string;
	user_id: string;
	created_by: string | null;
	org_id: string;
	name: string;
	scopes: string[];
	created_at: string;
	expires_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

interface ApiTokenRow extends SummaryRow {
	token_hash: string;
}

interface RevokedRow {
	id: string;
	org_id: string;
}

function rowToSummary(row: SummaryRow): ApiTokenSummary {
	return {
		id: row.id,
		userId: row.user_id,
		createdBy: row.created_by,
		orgId: row.org_id,
		name: row.name,
		scopes: row.scopes,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at
	};
}

function rowToToken(row: ApiTokenRow): ApiToken {
	return { ...rowToSummary(row), tokenHash: row.token_hash };
}

function tokenToRow(t: ApiToken): ApiTokenRow {
	return {
		id: t.id,
		user_id: t.userId,
		created_by: t.createdBy,
		org_id: t.orgId,
		name: t.name,
		token_hash: t.tokenHash,
		scopes: t.scopes,
		created_at: t.createdAt,
		expires_at: t.expiresAt,
		last_used_at: t.lastUsedAt,
		revoked_at: t.revokedAt
	};
}
