import * as path from 'node:path';
import type {
	IUserProfileStore,
	RecentRun,
	RequestContext,
	UserManagementResult,
	UserProfile
} from '@selva/platform';
import { ProviderError, hasPermission } from '@selva/platform';
import { createLocalUserMetaProvider } from '../auth/users.js';
import type { LocalUserMetaProvider, StoredUser } from '../auth/users.js';

function toProfile(u: Pick<StoredUser, 'id' | 'displayName' | 'starredDefinitions' | 'recentRuns'>): UserProfile {
	return {
		userId: u.id,
		displayName: u.displayName,
		starredDefinitions: u.starredDefinitions ?? [],
		recentRuns: u.recentRuns ?? []
	};
}

/**
 * Filesystem-backed user-profile store. Reads and writes the same users.json
 * the LocalAuthProvider uses, but exposes only the profile surface — identity
 * + platform permissions stay on LocalAuthProvider.
 */
export class LocalUserProfileProvider implements IUserProfileStore {
	private readonly users: LocalUserMetaProvider;

	constructor(usersFilePath: string) {
		this.users = createLocalUserMetaProvider(usersFilePath);
	}

	static fromEnv(env: Record<string, string | undefined>): LocalUserProfileProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalUserProfileProvider(path.join(env.DATA_PATH, 'users.json'));
	}

	async getProfile(ctx: RequestContext, userId: string): Promise<UserProfile | null> {
		assertCanAccess(ctx, userId);
		const u = await this.users.findById(userId);
		return u ? toProfile(u) : null;
	}

	async getProfiles(_ctx: RequestContext, userIds: readonly string[]): Promise<UserProfile[]> {
		// Batch read is read-only and used for display name lookups across the UI;
		// scoping to a single user defeats the purpose. Adapters with stricter
		// requirements should override.
		const all = await this.users.listUsers();
		const wanted = new Set(userIds);
		return all.filter((u) => wanted.has(u.id)).map(toProfile);
	}

	async updateProfile(
		ctx: RequestContext,
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		try {
			await this.users.updateProfile(userId, patch);
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
			await this.users.starDefinition(userId, definitionId);
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
			await this.users.unstarDefinition(userId, definitionId);
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
			await this.users.recordRun(userId, run);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}
}

/**
 * Profile reads/writes are scoped to the user themselves. `instance_admin`
 * bypasses for admin tooling. `system: true` (background jobs, signup
 * auto-seed) also passes — those flows have already authorized.
 */
function assertCanAccess(ctx: RequestContext, userId: string): void {
	if (ctx.system) return;
	if (ctx.userId === userId) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	throw new ProviderError('Forbidden: cannot access another user’s profile', 403);
}
