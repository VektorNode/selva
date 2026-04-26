import type {
	IPlatformPermissionStore,
	PlatformPermission,
	RequestContext,
	UserManagementResult
} from '@selva/platform';
import { ProviderError, hasPermission, PlatformPermissionSchema } from '@selva/platform';
import type { ClientBundle } from '../data/client.js';

/**
 * Supabase-backed platform-permission store. Reads and writes
 * `public.user_profiles.platform_permissions` (auto-seeded by the
 * `handle_new_auth_user` trigger). Service-role throughout — the store's own
 * `assertAdmin` / `assertCanRead` enforce the auth boundary at the app level
 * since RLS on `user_profiles` is coarse-grained for cross-user reads.
 *
 * Disabled-user state lives on `auth.users.user_metadata.disabled`, so the
 * invariant counters cross-reference the auth backend to exclude disabled
 * admins (matches `Permissions.md §10` "enabled instance_admin" semantics).
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
		// 1. Confirm the target exists in the auth backend (the FK + trigger
		//    means the user_profiles row should exist post-signup; if not,
		//    treat as not_found rather than auto-creating).
		const { data: existing, error: fetchError } = await this.client()
			.from('user_profiles')
			.select('platform_permissions')
			.eq('user_id', userId)
			.maybeSingle();
		if (fetchError) throw mapError(fetchError);
		if (!existing) return 'not_found';

		// 2. §2 invariant: refuse if dropping the last instance_admin.
		const wasAdmin = (existing.platform_permissions ?? []).includes('instance_admin');
		const willBeAdmin = permissions.includes('instance_admin');
		if (wasAdmin && !willBeAdmin) {
			const others = await this.countOtherEnabledAdmins(userId);
			if (others === 0) return 'last_admin';
		}

		// 3. Apply.
		const { error } = await this.client()
			.from('user_profiles')
			.update({ platform_permissions: [...permissions] })
			.eq('user_id', userId);
		if (error) throw mapError(error);
		return 'ok';
	}

	async hasInstanceAdmin(_ctx: RequestContext): Promise<boolean> {
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('user_id')
			.contains('platform_permissions', ['instance_admin']);
		if (error) throw mapError(error);
		const candidates = (data ?? []).map((r) => r.user_id as string);
		if (candidates.length === 0) return false;
		// Check at least one isn't disabled.
		for (const id of candidates) {
			const { data: authData } = await this.clients.serviceClient.auth.admin.getUserById(id);
			if (authData.user && authData.user.user_metadata?.disabled !== true) return true;
		}
		return false;
	}

	async countInstanceAdminsExcluding(_ctx: RequestContext, excludeUserId: string): Promise<number> {
		return this.countOtherEnabledAdmins(excludeUserId);
	}

	private async countOtherEnabledAdmins(excludeUserId: string): Promise<number> {
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('user_id')
			.contains('platform_permissions', ['instance_admin'])
			.neq('user_id', excludeUserId);
		if (error) throw mapError(error);
		const candidates = (data ?? []).map((r) => r.user_id as string);
		if (candidates.length === 0) return 0;
		let count = 0;
		for (const id of candidates) {
			const { data: authData } = await this.clients.serviceClient.auth.admin.getUserById(id);
			if (authData.user && authData.user.user_metadata?.disabled !== true) count += 1;
		}
		return count;
	}
}

function filterValid(raw: readonly string[]): PlatformPermission[] {
	return raw.filter((p): p is PlatformPermission => PlatformPermissionSchema.safeParse(p).success);
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
