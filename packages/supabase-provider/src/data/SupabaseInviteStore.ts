import type {
	IInviteStore,
	Invite,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
import type { ClientBundle } from './client.js';
import { nextCursorFromRange, toRange } from './pagination.js';

/**
 * Invite store. `getByToken` and `accept` route through SECURITY DEFINER
 * RPCs so unauthenticated / just-signed-up callers can validate and consume
 * the invite without RLS blocking them. Other operations (create, list,
 * revoke) go through the normal REST API with RLS enforcing `manage_users`.
 */
export class SupabaseInviteStore implements IInviteStore {
	constructor(private readonly clients: ClientBundle) {}

	async create(ctx: RequestContext, invite: Invite): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.insert(inviteToRow(invite));
		if (error) throw mapError(error);
	}

	async getByToken(ctx: RequestContext, token: string): Promise<Invite | null> {
		// Use the SECURITY DEFINER RPC so the token itself is the capability —
		// unauthenticated callers visiting /accept-invite can resolve it.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.rpc('get_invite_by_token', { t: token });
		if (error) throw mapError(error);
		// rpc returns the matching row (or null). PostgREST may wrap it in
		// an array depending on the signature — normalize both shapes.
		const row = Array.isArray(data) ? data[0] : data;
		return row ? rowToInvite(row as InviteRow) : null;
	}

	async listByOrg(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<Invite>> {
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.select('*', { count: 'exact' })
			.eq('org_id', orgId)
			.order('created_at', { ascending: (opts?.orderDir ?? 'desc') === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapError(error);
		const items = (data ?? []).map(rowToInvite);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async markAccepted(ctx: RequestContext, id: string, userId: string): Promise<void> {
		// Direct UPDATE — the caller is authenticated (they just signed up).
		// `markAccepted` is idempotent so we don't error if no row matches.
		const { error } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.update({ accepted_at: new Date().toISOString(), accepted_by_user_id: userId })
			.eq('id', id)
			.is('accepted_at', null);
		if (error) throw mapError(error);
	}

	async revoke(ctx: RequestContext, id: string): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.delete()
			.eq('id', id)
			.is('accepted_at', null);
		if (error) throw mapError(error);
	}
}

interface InviteRow {
	id: string;
	token: string;
	email: string;
	org_id: string;
	org_role: Invite['orgRole'];
	org_permissions: string[];
	invited_by: string;
	created_at: string;
	expires_at: string;
	accepted_at: string | null;
	accepted_by_user_id: string | null;
}

function rowToInvite(row: InviteRow): Invite {
	return {
		id: row.id,
		token: row.token,
		email: row.email,
		orgId: row.org_id,
		orgRole: row.org_role,
		orgPermissions: row.org_permissions as Invite['orgPermissions'],
		invitedBy: row.invited_by,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		acceptedAt: row.accepted_at ?? undefined,
		acceptedByUserId: row.accepted_by_user_id ?? undefined
	};
}

function inviteToRow(i: Invite): InviteRow {
	return {
		id: i.id,
		token: i.token,
		email: i.email,
		org_id: i.orgId,
		org_role: i.orgRole,
		org_permissions: i.orgPermissions,
		invited_by: i.invitedBy,
		created_at: i.createdAt,
		expires_at: i.expiresAt,
		accepted_at: i.acceptedAt ?? null,
		accepted_by_user_id: i.acceptedByUserId ?? null
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
		const obj = e as { message?: string; code?: string };
		return new Error(obj.code ? `[${obj.code}] ${obj.message ?? ''}` : obj.message ?? String(e));
	}
	return new Error(String(e));
}
