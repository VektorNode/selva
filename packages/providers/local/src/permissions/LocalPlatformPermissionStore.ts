import * as path from 'node:path';
import type {
	IPlatformPermissionStore,
	PlatformPermission,
	RequestContext,
	UserManagementResult
} from '@selvajs/platform';
import { ProviderError, hasPermission } from '@selvajs/platform';
import { createLocalUserDataStore, type LocalUserDataStore } from '../data/userData.js';

/**
 * Filesystem-backed platform-permission store. Reads and writes the
 * `platformPermissions` field on `user-data.json` — a data-layer file owned
 * by `LocalDataProvider`, distinct from `auth-users.json` which the
 * `LocalAuthProvider` owns. This split lets the local data layer pair with
 * any auth provider (local, Supabase, Entra, Eterna, …): the data layer only
 * cares about the user ID, never about how identity is stored.
 *
 * The "user is known to the data layer" precondition is established by
 * `IDataProvider.ensureUser`, called from `hooks.server.ts` on every authed
 * request — the local equivalent of the Supabase `handle_new_auth_user`
 * trigger. After that call, `set` finds a row and `getFor` reads it; before
 * it, `set` returns `not_found` (matching the conformance contract).
 *
 * Enforces:
 *   - The §2 sole-`instance_admin` invariant on `set` (refuses to drop the
 *     last admin)
 *   - Authorization on read/write (`assertCanRead` / `assertCanWrite`)
 *
 * "Disabled" state lives on the auth provider's user record. The local
 * provider's permission store can't see across that boundary, so the
 * invariant counters here treat every row in `user-data.json` as enabled.
 * Code that disables a user is expected to also drop their `instance_admin`
 * grant via `set` (the §2 invariant kicks in there) before the auth-side
 * disable lands — see `LocalAuthProvider.disableUser`.
 */
export class LocalPlatformPermissionStore implements IPlatformPermissionStore {
	private readonly data: LocalUserDataStore;

	static fromEnv(env: Record<string, string | undefined>): LocalPlatformPermissionStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalPlatformPermissionStore(path.join(env.DATA_PATH, 'user-data.json'));
	}

	/**
	 * Accepts a file path (constructs its own store) OR a shared
	 * `LocalUserDataStore`. `LocalDataProvider` injects one shared store so the
	 * permission, profile, and data-provider views of `user-data.json` share a
	 * single load-once write-through cache (§3a).
	 */
	constructor(userData: string | LocalUserDataStore) {
		this.data = typeof userData === 'string' ? createLocalUserDataStore(userData) : userData;
	}

	async getFor(ctx: RequestContext, userId: string): Promise<PlatformPermission[]> {
		assertCanRead(ctx, userId);
		const row = await this.data.findById(userId);
		return row?.platformPermissions ?? [];
	}

	async getForBatch(
		ctx: RequestContext,
		userIds: readonly string[]
	): Promise<Map<string, PlatformPermission[]>> {
		assertCanReadBatch(ctx);
		const all = await this.data.listAll();
		const wanted = new Set(userIds);
		const out = new Map<string, PlatformPermission[]>();
		for (const u of all) {
			if (wanted.has(u.userId)) out.set(u.userId, u.platformPermissions ?? []);
		}
		return out;
	}

	async set(
		ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<UserManagementResult> {
		assertAdmin(ctx);
		const target = await this.data.findById(userId);
		if (!target) return 'not_found';
		const wasAdmin = target.platformPermissions.includes('instance_admin');
		const willBeAdmin = permissions.includes('instance_admin');
		if (wasAdmin && !willBeAdmin) {
			const others = await this.countOtherAdmins(userId);
			if (others === 0) return 'last_admin';
		}
		try {
			await this.data.updatePermissions(userId, [...permissions]);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async hasInstanceAdmin(_ctx: RequestContext): Promise<boolean> {
		// First-run + invariant check — always allowed (read-only existence
		// probe). The route layer decides what to do with the answer.
		const all = await this.data.listAll();
		return all.some((u) => u.platformPermissions.includes('instance_admin'));
	}

	async countInstanceAdminsExcluding(_ctx: RequestContext, excludeUserId: string): Promise<number> {
		return this.countOtherAdmins(excludeUserId);
	}

	private async countOtherAdmins(excludeUserId: string): Promise<number> {
		const all = await this.data.listAll();
		return all.filter(
			(u) => u.userId !== excludeUserId && u.platformPermissions.includes('instance_admin')
		).length;
	}
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

function assertCanReadBatch(ctx: RequestContext): void {
	if (ctx.system) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	if (hasPermission(ctx, 'manage_instance_users')) return;
	throw new ProviderError('Forbidden: instance admin or manage_instance_users required', 403);
}
