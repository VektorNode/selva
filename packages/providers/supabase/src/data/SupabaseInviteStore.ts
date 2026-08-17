import type {
	IInviteStore,
	IEventSink,
	Invite,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import { NoopEventSink, actorFrom } from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';
import { nextCursorFromRange, toRange } from './pagination.js';

/** Explicit column list for `invites` — every field `rowToInvite` consumes. */
const INVITE_COLUMNS =
	'id, token_hash, email, org_id, org_role, org_permissions, platform_permissions, invited_by, created_at, expires_at, accepted_at, accepted_by_user_id';

/**
 * Invite store. `getByTokenHash` routes through a SECURITY DEFINER RPC so an
 * unauthenticated caller (still validating an invite link) can resolve it
 * without RLS blocking them. The raw token is hashed at the route layer
 * (`invites/token.server.ts` in the selva app); this store only ever sees the
 * HMAC digest. Other operations go through the normal REST API, with RLS
 * enforcing `manage_org_members`.
 */
export class SupabaseInviteStore implements IInviteStore {
	constructor(
		private readonly clients: ClientBundle,
		private readonly events: IEventSink = new NoopEventSink()
	) {}

	async create(ctx: RequestContext, invite: Invite): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.insert(inviteToRow(invite));
		if (error) throw mapPostgrestError(error);
		await this.events.emit({
			type: 'invite.created',
			inviteId: invite.id,
			orgId: invite.orgId,
			email: invite.email,
			actorId: actorFrom(ctx)
		});
	}

	async getByTokenHash(ctx: RequestContext, tokenHash: string): Promise<Invite | null> {
		// SECURITY DEFINER RPC: the token itself is the capability, so an
		// unauthenticated caller on /accept-invite can still resolve it.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.rpc('get_invite_by_token_hash', { h: tokenHash });
		if (error) throw mapPostgrestError(error);
		// PostgREST may wrap a scalar-returning RPC result in an array depending
		// on the function signature — normalize both shapes.
		const row = Array.isArray(data) ? data[0] : data;
		return row ? rowToInvite(row as InviteRow) : null;
	}

	async listByOrg(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Invite>> {
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.select(INVITE_COLUMNS, { count: 'exact' })
			.eq('org_id', orgId)
			.order('created_at', { ascending: (opts?.orderDir ?? 'desc') === 'asc' })
			.range(range.from, range.to);
		if (error) throw mapPostgrestError(error);
		const items = (data ?? []).map(rowToInvite);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async markAccepted(ctx: RequestContext, id: string, userId: string): Promise<void> {
		// Idempotent: `.is('accepted_at', null)` means a second call just no-ops.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.update({ accepted_at: new Date().toISOString(), accepted_by_user_id: userId })
			.eq('id', id)
			.is('accepted_at', null)
			.select('org_id');
		if (error) throw mapPostgrestError(error);
		const row = data?.[0];
		if (!row) return;
		await this.events.emit({
			type: 'invite.accepted',
			inviteId: id,
			orgId: (row as { org_id: string }).org_id,
			userId,
			actorId: actorFrom(ctx)
		});
	}

	async revoke(ctx: RequestContext, id: string): Promise<void> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.delete()
			.eq('id', id)
			.is('accepted_at', null)
			.select('org_id');
		if (error) throw mapPostgrestError(error);
		const row = data?.[0];
		if (!row) return;
		await this.events.emit({
			type: 'invite.revoked',
			inviteId: id,
			orgId: (row as { org_id: string }).org_id,
			actorId: actorFrom(ctx)
		});
	}

	async deleteByOrg(ctx: RequestContext, orgId: string): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('invites')
			.delete()
			.eq('org_id', orgId);
		if (error) throw mapPostgrestError(error);
	}
}

interface InviteRow {
	id: string;
	token_hash: string;
	email: string;
	org_id: string;
	org_role: Invite['orgRole'];
	org_permissions: string[];
	platform_permissions: string[];
	invited_by: string;
	created_at: string;
	expires_at: string;
	accepted_at: string | null;
	accepted_by_user_id: string | null;
}

function rowToInvite(row: InviteRow): Invite {
	return {
		id: row.id,
		tokenHash: row.token_hash,
		email: row.email,
		orgId: row.org_id,
		orgRole: row.org_role,
		orgPermissions: row.org_permissions as Invite['orgPermissions'],
		// `?? []` covers a row read through a client whose projection predates the
		// column, not a null default — the column is `not null default '{}'`.
		platformPermissions: (row.platform_permissions ?? []) as NonNullable<
			Invite['platformPermissions']
		>,
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
		token_hash: i.tokenHash,
		email: i.email,
		org_id: i.orgId,
		org_role: i.orgRole,
		org_permissions: i.orgPermissions,
		platform_permissions: i.platformPermissions ?? [],
		invited_by: i.invitedBy,
		created_at: i.createdAt,
		expires_at: i.expiresAt,
		accepted_at: i.acceptedAt ?? null,
		accepted_by_user_id: i.acceptedByUserId ?? null
	};
}
