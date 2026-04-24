import * as path from 'node:path';
import type { IUserProfileStore, RecentRun, UserManagementResult } from '@selva/platform';
import { ProviderError } from '@selva/platform';
import { createLocalUserMetaProvider } from '../auth/users.js';
import type { LocalUserMetaProvider } from '../auth/users.js';

/**
 * Filesystem-backed user-profile store. Reads and writes the same users.json
 * the LocalAuthProvider uses, but exposes only the profile-mutation surface.
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
