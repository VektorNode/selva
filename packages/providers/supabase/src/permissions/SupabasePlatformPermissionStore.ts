import type {
	IPlatformPermissionStore,
	PlatformPermission,
	RequestContext,
	UserManagementResult
} from '@selvajs/platform';
import { ProviderError, hasPermission, ALL_PLATFORM_PERMISSIONS } from '@selvajs/platform';
import type { ClientBundle } from '../data/client.js';

/**
 * Reads and writes `public.user_profiles.platform_permissions` (auto-seeded
 * by the `handle_new_auth_user` trigger). Service-role throughout — RLS on
 * `user_profiles` is too coarse for cross-user reads, so `assertAdmin` /
 * `assertCanRead` enforce the auth boundary here instead.
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
		assertCanRead(ctx, userId);
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
		assertAdmin(ctx);
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
		assertAdmin(ctx);
		const { data: existing, error: fetchError } = await this.client()
			.from('user_profiles')
			.select('platform_permissions')
			.eq('user_id', userId)
			.maybeSingle();
		if (fetchError) throw mapError(fetchError);
		if (!existing) return 'not_found';

		// Refuse to drop the last enabled instance_admin.
		const wasAdmin = (existing.platform_permissions ?? []).includes('instance_admin');
		const willBeAdmin = permissions.includes('instance_admin');
		if (wasAdmin && !willBeAdmin) {
			const others = await this.countOtherEnabledAdmins(userId);
			if (others === 0) return 'last_admin';
		}

		const { error } = await this.client()
			.from('user_profiles')
			.update({ platform_permissions: [...permissions] })
			.eq('user_id', userId);
		if (error) throw mapError(error);
		return 'ok';
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

function assertCanRead(ctx: RequestContext, userId: string): void {
	if (ctx.system) return;
	if (ctx.userId === userId) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	throw new ProviderError('Forbidden: cannot read another user’s permissions', 403);
}

function assertAdmin(ctx: RequestContext): void {
	if (ctx.system) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	throw new ProviderError('Forbidden: instance admin required', 403);
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
