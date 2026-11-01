import type {
	IPlatformPermissionStore,
	PlatformPermission,
	RequestContext,
	UserManagementResult
} from '@selvajs/platform';
import { ProviderError, ALL_PLATFORM_PERMISSIONS } from '@selvajs/platform';
import {
	assertCanManagePermissions,
	assertCanReadPermissions,
	assertCanReadPermissionsBatch
} from '@selvajs/platform/permissions';
import type { ClientBundle } from '../data/client.js';

/**
 * Reads and writes `public.user_profiles.platform_permissions` (auto-seeded
 * by the `handle_new_auth_user` trigger). Service-role throughout — RLS on
 * `user_profiles` is too coarse for cross-user reads, so `assertCanManagePermissions` /
 * `assertCanReadPermissions` enforce the auth boundary here instead.
 *
 * `user_profiles.disabled` mirrors `auth.users.user_metadata.disabled` via
 * the `sync_auth_user_disabled` trigger, so admin-count queries can exclude
 * disabled admins with a single indexed query instead of cross-referencing
 * the auth admin API per candidate.
 */
export class SupabasePlatformPermissionStore implements IPlatformPermissionStore {
	constructor(private readonly clients: ClientBundle) {}

	private client() {
		return this.clients.serviceClient;
	}

	async getFor(ctx: RequestContext, userId: string): Promise<PlatformPermission[]> {
		assertCanReadPermissions(ctx, userId);
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('platform_permissions')
			.eq('user_id', userId)
			.maybeSingle();
		if (error) throw mapError(error);
		return filterValid(data?.platform_permissions ?? []);
	}

	async getForBatch(
		ctx: RequestContext,
		userIds: readonly string[]
	): Promise<Map<string, PlatformPermission[]>> {
		assertCanReadPermissionsBatch(ctx);
		const out = new Map<string, PlatformPermission[]>();
		if (userIds.length === 0) return out;
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('user_id, platform_permissions')
			.in('user_id', [...userIds]);
		if (error) throw mapError(error);
		for (const row of data ?? []) {
			out.set(row.user_id as string, filterValid((row.platform_permissions ?? []) as string[]));
		}
		return out;
	}

	async set(
		ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<UserManagementResult> {
		assertCanManagePermissions(ctx);

		// The §2 last-admin check lives inside the UPDATE's WHERE clause, so it
		// is evaluated under the row lock that guards the write. Doing it here
		// as count-then-update let two concurrent demotions each observe the
		// other as "another admin exists" and both commit, leaving zero admins.
		const { data, error } = await this.client().rpc('set_platform_permissions', {
			p_user_id: userId,
			p_permissions: [...permissions]
		});
		if (error) throw mapError(error);
		if ((data ?? 0) > 0) return 'ok';

		// Zero rows written: either the row is absent, or the predicate refused
		// the demotion. Only the second is `last_admin`, so disambiguate.
		const { data: existing, error: fetchError } = await this.client()
			.from('user_profiles')
			.select('user_id')
			.eq('user_id', userId)
			.maybeSingle();
		if (fetchError) throw mapError(fetchError);
		return existing ? 'last_admin' : 'not_found';
	}

	async claimFirstInstanceAdmin(
		_ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<boolean> {
		// No `assertCanManagePermissions`: by definition nobody holds `instance_admin` when this
		// succeeds. The RPC takes an advisory lock and re-reads inside it, so a
		// second concurrent signer blocks and then correctly loses.
		const { data, error } = await this.client().rpc('claim_first_instance_admin', {
			p_user_id: userId,
			p_permissions: [...permissions]
		});
		if (error) throw mapError(error);
		return data === true;
	}

	async hasInstanceAdmin(_ctx: RequestContext): Promise<boolean> {
		const { count, error } = await this.client()
			.from('user_profiles')
			.select('user_id', { count: 'exact', head: true })
			.contains('platform_permissions', ['instance_admin'])
			.eq('disabled', false);
		if (error) throw mapError(error);
		return (count ?? 0) > 0;
	}

	async countInstanceAdminsExcluding(_ctx: RequestContext, excludeUserId: string): Promise<number> {
		return this.countOtherEnabledAdmins(excludeUserId);
	}

	private async countOtherEnabledAdmins(excludeUserId: string): Promise<number> {
		const { count, error } = await this.client()
			.from('user_profiles')
			.select('user_id', { count: 'exact', head: true })
			.contains('platform_permissions', ['instance_admin'])
			.eq('disabled', false)
			.neq('user_id', excludeUserId);
		if (error) throw mapError(error);
		return count ?? 0;
	}
}

const VALID_PERMISSIONS = new Set<string>(ALL_PLATFORM_PERMISSIONS);

function filterValid(raw: readonly string[]): PlatformPermission[] {
	return raw.filter((p): p is PlatformPermission => VALID_PERMISSIONS.has(p));
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
		return new Error(obj.code ? `[${obj.code}] ${obj.message ?? ''}` : (obj.message ?? String(e)));
	}
	return new Error(String(e));
}
