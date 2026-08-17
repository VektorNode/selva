import * as path from 'node:path';
import type {
	IUserProfileStore,
	RecentRun,
	RequestContext,
	UserManagementResult,
	UserProfile
} from '@selvajs/platform';
import { ProviderError, hasPermission, assertNotShareContext } from '@selvajs/platform';
import {
	createLocalUserDataStore,
	type LocalUserDataStore,
	type StoredUserData
} from '../data/userData.js';

function toProfile(u: StoredUserData): UserProfile {
	return {
		userId: u.userId,
		displayName: u.displayName,
		starredDefinitions: u.starredDefinitions ?? [],
		recentRuns: u.recentRuns ?? []
	};
}

/**
 * Filesystem-backed user-profile store. Reads and writes `user-data.json`,
 * shared with `LocalPlatformPermissionStore`. Keys exclusively by user ID;
 * identity (email, password hash) lives separately on the auth provider.
 * `IDataProvider.ensureUser` (called from `hooks.server.ts`) seeds an empty
 * row for every authed user.
 */
export class LocalUserProfileProvider implements IUserProfileStore {
	private readonly data: LocalUserDataStore;

	/**
	 * Accepts a file path (constructs its own store — for `fromEnv` and
	 * standalone conformance tests) or a shared `LocalUserDataStore`.
	 * `LocalDataProvider` injects one store shared with the permission store
	 * and the data provider so all three see the same load-once write-through
	 * cache over `user-data.json` (§3a) — separate stores on the same file
	 * would diverge.
	 */
	constructor(userData: string | LocalUserDataStore) {
		this.data = typeof userData === 'string' ? createLocalUserDataStore(userData) : userData;
	}

	static fromEnv(env: Record<string, string | undefined>): LocalUserProfileProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalUserProfileProvider(path.join(env.DATA_PATH, 'user-data.json'));
	}

	async getProfile(ctx: RequestContext, userId: string): Promise<UserProfile | null> {
		assertCanAccess(ctx, userId);
		const u = await this.data.findById(userId);
		return u ? toProfile(u) : null;
	}

	async getProfiles(_ctx: RequestContext, userIds: readonly string[]): Promise<UserProfile[]> {
		// Unscoped by design: used for display-name lookups across the UI.
		// Adapters needing per-caller restriction should override.
		const all = await this.data.listAll();
		const wanted = new Set(userIds);
		return all.filter((u) => wanted.has(u.userId)).map(toProfile);
	}

	async updateProfile(
		ctx: RequestContext,
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		try {
			if (patch.displayName !== undefined) {
				await this.data.updateDisplayName(userId, patch.displayName);
			}
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async starDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		try {
			await this.data.starDefinition(userId, definitionId);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async unstarDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		try {
			await this.data.unstarDefinition(userId, definitionId);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async recordRun(
		ctx: RequestContext,
		userId: string,
		run: RecentRun
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		try {
			await this.data.recordRun(userId, run);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}
}

/** Scoped to the user themselves; `instance_admin` and `system: true` callers bypass. */
function assertCanAccess(ctx: RequestContext, userId: string): void {
	assertNotShareContext(ctx, 'access user profiles');
	if (ctx.system) return;
	if (ctx.userId === userId) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	throw new ProviderError('Forbidden: cannot access another user’s profile', 403);
}
