import type {
	IShareLinkStore,
	IEventSink,
	ShareLink,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { ProviderError, actorFrom, NoopEventSink } from '@selva/platform';
import type { ClientBundle } from './client.js';
import { nextCursorFromRange, toRange } from './pagination.js';

/**
 * Spec §7 — share-link store backed by Postgres.
 *
 * Token resolution (`getByTokenHash`) and atomic increment use the
 * SECURITY DEFINER `try_increment_share_link_solve_count` RPC + service-
 * role client to bypass RLS — the token IS the credential, not the
 * authenticated user identity.
 *
 * `tryIncrementSolveCount` returns a single number on success or null when
 * the cap is hit. The RPC enforces "increment iff under cap and live" in
 * one statement, so even concurrent solves can't overshoot the cap.
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
		if (error) throw mapError(error);
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
			.select('*', { count: 'exact' })
			.eq('definition_guid', definitionId)
			.is('revoked_at', null)
			.order('created_at', { ascending: false })
			.range(range.from, range.to);
		if (error) throw mapError(error);
		const items = (data ?? []).map(rowToLink);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getById(ctx: RequestContext, id: string): Promise<ShareLink | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('share_links')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToLink(data) : null;
	}

	async getByTokenHash(_ctx: RequestContext, tokenHash: string): Promise<ShareLink | null> {
		// Service-role: token resolution must work for anonymous requests too.
		// RLS would scope the query down to "links the current user can see"
		// — exactly the wrong semantic for token-credentialed access.
		const { data, error } = await this.clients.serviceClient
			.from('share_links')
			.select('*, definitions!inner(deleted_at)')
			.eq('token_hash', tokenHash)
			.is('revoked_at', null)
			.is('definitions.deleted_at', null)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToLink(data) : null;
	}

	async revoke(ctx: RequestContext, id: string): Promise<void> {
		// Idempotent: succeeds whether or not the row exists / is already
		// revoked. The `is null` predicate on revoked_at means a re-revoke
		// is a no-op (no row updated).
		const { error } = await this.clients
			.forRequest(ctx)
			.from('share_links')
			.update({ revoked_at: new Date().toISOString() })
			.eq('id', id)
			.is('revoked_at', null);
		if (error) throw mapError(error);
		await this.events.emit({ type: 'share_link.revoked', linkId: id, actorId: actorFrom(ctx) });
	}

	async tryIncrementSolveCount(_ctx: RequestContext, id: string): Promise<number | null> {
		// SECURITY DEFINER RPC — bypasses RLS. Atomic check-and-increment.
		// Returns NULL when the link is missing/revoked/expired/capped; the
		// row update is the only way to get a numeric return.
		const { data, error } = await this.clients.serviceClient.rpc(
			'try_increment_share_link_solve_count',
			{ link_id: id }
		);
		if (error) throw mapError(error);
		return typeof data === 'number' ? data : null;
	}
}

// ── Row ↔ domain mappers ────────────────────────────────────────────────

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

interface PostgrestError {
	code?: string;
	message?: string;
}

function mapError(e: unknown): Error {
	const pg = e as PostgrestError;
	if (pg?.code === '23505') return new ProviderError(pg.message ?? 'Duplicate record', 409);
	if (pg?.code === '23503') return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	if (e instanceof Error) return e;
	if (e && typeof e === 'object') {
		const obj = e as { message?: string; details?: string; hint?: string; code?: string };
		const msg = obj.message ?? obj.details ?? obj.hint ?? 'Unknown Postgres error';
		const err = new Error(obj.code ? `[${obj.code}] ${msg}` : msg);
		Object.assign(err, obj);
		return err;
	}
	return new Error(String(e));
}
