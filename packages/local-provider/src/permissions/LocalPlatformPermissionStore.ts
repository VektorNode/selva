import * as path from 'node:path';
import type {
	IPlatformPermissionStore,
	PlatformPermission,
	RequestContext,
	UserManagementResult
} from '@selva/platform';
import { ProviderError, hasPermission } from '@selva/platform';
import { createLocalUserMetaProvider, type LocalUserMetaProvider } from '../auth/users.js';

/**
 * Filesystem-backed platform-permission store. Reads and writes the same
 * `platformPermissions` field on `users.json` that LocalAuthProvider used to
 * own — no data migration; just a different access surface.
 *
 * Enforces:
 *   - The §2 sole-`instance_admin` invariant on `set` (refuses to drop the
 *     last admin)
 *   - Authorization on read/write (`assertCanRead` / `assertCanWrite`)
 */
export class LocalPlatformPermissionStore implements IPlatformPermissionStore {
	private readonly users: LocalUserMetaProvider;

	static fromEnv(env: Record<string, string | undefined>): LocalPlatformPermissionStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalPlatformPermissionStore(path.join(env.DATA_PATH, 'users.json'));
	}

	constructor(usersFilePath: string) {
		this.users = createLocalUserMetaProvider(usersFilePath);
	}

	async getFor(ctx: RequestContext, userId: string): Promise<PlatformPermission[]> {
		assertCanRead(ctx, userId);
		const u = await this.users.findById(userId);
		return u?.platformPermissions ?? [];
	}

	async getForBatch(
		ctx: RequestContext,
		userIds: readonly string[]
	): Promise<Map<string, PlatformPermission[]>> {
		assertAdmin(ctx);
		const all = await this.users.listUsers();
		const wanted = new Set(userIds);
		const out = new Map<string, PlatformPermission[]>();
		for (const u of all) {
			if (wanted.has(u.id)) out.set(u.id, u.platformPermissions ?? []);
		}
		return out;
	}

	async set(
		ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<UserManagementResult> {
		assertAdmin(ctx);
		const target = await this.users.findById(userId);
		if (!target) return 'not_found';
		const wasAdmin = target.platformPermissions.includes('instance_admin');
		const willBeAdmin = permissions.includes('instance_admin');
		if (wasAdmin && !willBeAdmin) {
			const others = await this.countOtherEnabledAdmins(userId);
			if (others === 0) return 'last_admin';
		}
		try {
			await this.users.updatePlatformPermissions(userId, [...permissions]);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async hasInstanceAdmin(_ctx: RequestContext): Promise<boolean> {
		// First-run + invariant check — always allowed (read-only existence
		// probe). The route layer decides what to do with the answer.
		const all = await this.users.listUsers();
		return all.some((u) => !u.disabled && u.platformPermissions.includes('instance_admin'));
	}

	async countInstanceAdminsExcluding(_ctx: RequestContext, excludeUserId: string): Promise<number> {
		const all = await this.users.listUsers();
		return all.filter(
			(u) =>
				u.id !== excludeUserId && !u.disabled && u.platformPermissions.includes('instance_admin')
		).length;
	}

	private async countOtherEnabledAdmins(excludeUserId: string): Promise<number> {
		const all = await this.users.listUsers();
		return all.filter(
			(u) =>
				u.id !== excludeUserId && !u.disabled && u.platformPermissions.includes('instance_admin')
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
