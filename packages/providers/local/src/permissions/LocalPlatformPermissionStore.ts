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
 * Filesystem-backed platform-permission store. Reads/writes the
 * `platformPermissions` field on `user-data.json`, owned by
 * `LocalDataProvider` and separate from `auth-users.json` (owned by
 * `LocalAuthProvider`) — the data layer only ever keys by user ID, never by
 * how identity is stored, so it pairs with any auth provider.
 *
 * Rows are seeded by `IDataProvider.ensureUser` (called per authed request
 * from `hooks.server.ts`); before that call `set` returns `not_found`.
 *
 * `set` enforces the §2 sole-`instance_admin` invariant (refuses to drop the
 * last admin). It has no visibility into "disabled" state, which lives on
 * the auth provider's record — **every row here counts as enabled**. A
 * disabled admin would therefore still satisfy the "another admin exists"
 * check and let the last enabled one be demoted, so whoever disables a user
 * must revoke `instance_admin` through `set` first. That sequencing lives in
 * the disable route (`POST /api/admin/users/[id]/disable`), which holds both
 * this store and the auth provider; `LocalAuthProvider` deliberately has no
 * reference to the permission store.
 */
export class LocalPlatformPermissionStore implements IPlatformPermissionStore {
	private readonly data: LocalUserDataStore;

	static fromEnv(env: Record<string, string | undefined>): LocalPlatformPermissionStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalPlatformPermissionStore(path.join(env.DATA_PATH, 'user-data.json'));
	}

	/**
	 * Accepts a file path (constructs its own store) or a shared
	 * `LocalUserDataStore` — `LocalDataProvider` injects one shared store so
	 * the permission, profile, and data-provider views of `user-data.json`
	 * share a single load-once write-through cache (§3a).
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
		// Read-only existence probe, always allowed — used for first-run checks.
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

// Reading one row and reading many must agree: `manage_instance_users` runs the
// user-admin surface, which needs to know who holds `instance_admin` in order
// to render locks correctly. Denying the single read while allowing the batch
// (as this file previously did) made the delete/disable routes throw a 500
// where they meant to return 403.
function assertCanRead(ctx: RequestContext, userId: string): void {
	if (ctx.system) return;
	if (ctx.userId === userId) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	if (hasPermission(ctx, 'manage_instance_users')) return;
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
