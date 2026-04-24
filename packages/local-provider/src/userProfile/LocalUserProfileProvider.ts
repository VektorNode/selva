import * as path from 'node:path';
import type {
	IUserProfileStore,
	RecentRun,
	UserManagementResult,
	UserProfile
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
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

	async getProfile(userId: string): Promise<UserProfile | null> {
		const u = await this.users.findById(userId);
		return u ? toProfile(u) : null;
	}

	async getProfiles(userIds: readonly string[]): Promise<UserProfile[]> {
		// One file read, filter in memory — cheap for local scale.
		const all = await this.users.listUsers();
		const wanted = new Set(userIds);
		return all.filter((u) => wanted.has(u.id)).map(toProfile);
	}

	async updateProfile(
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult> {
		try {
			await this.users.updateProfile(userId, patch);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async starDefinition(userId: string, definitionId: string): Promise<UserManagementResult> {
		try {
			await this.users.starDefinition(userId, definitionId);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async unstarDefinition(userId: string, definitionId: string): Promise<UserManagementResult> {
		try {
			await this.users.unstarDefinition(userId, definitionId);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async recordRun(userId: string, run: RecentRun): Promise<UserManagementResult> {
		try {
			await this.users.recordRun(userId, run);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}
}
