import { ProviderError } from '@selvajs/platform';
import type { PlatformPermission, RecentRun } from '@selvajs/platform';
import { readJsonFile, writeJsonFile } from './fsJson.js';

/**
 * Per-user state owned by the data layer, keyed by the auth provider's user
 * ID. Mirrors `public.user_profiles` in the Supabase schema. **Never holds
 * identity** (email, password hash, createdAt) — those live with the auth
 * provider, which may be anything from `LocalAuthProvider` to an external
 * IdP like Eterna ID.
 *
 * The local equivalent of Supabase's `handle_new_auth_user` trigger lives in
 * `hooks.server.ts`, which calls `IDataProvider.ensureUser` once per
 * authenticated request. After that call, every read here is guaranteed to
 * find a row.
 */
export interface StoredUserData {
	userId: string;
	displayName?: string;
	platformPermissions: PlatformPermission[];
	starredDefinitions: string[];
	recentRuns: RecentRun[];
}

export interface UserDataFile {
	users: StoredUserData[];
}

const MAX_RECENT_RUNS = 20;

const empty = (): UserDataFile => ({ users: [] });

function emptyRow(userId: string): StoredUserData {
	return {
		userId,
		platformPermissions: [],
		starredDefinitions: [],
		recentRuns: []
	};
}

export interface LocalUserDataStore {
	/**
	 * Idempotent. Adds an empty row if missing; no-op if present. Safe to call
	 * on every authed request.
	 */
	ensure(userId: string): Promise<void>;
	findById(userId: string): Promise<StoredUserData | null>;
	listAll(): Promise<StoredUserData[]>;
	updatePermissions(userId: string, permissions: PlatformPermission[]): Promise<void>;
	updateDisplayName(userId: string, displayName: string | undefined): Promise<void>;
	starDefinition(userId: string, definitionId: string): Promise<void>;
	unstarDefinition(userId: string, definitionId: string): Promise<void>;
	recordRun(userId: string, run: RecentRun): Promise<void>;
	deleteUser(userId: string): Promise<void>;
}

export function createLocalUserDataStore(filePath: string): LocalUserDataStore {
	async function findOrThrow(userId: string): Promise<{ file: UserDataFile; row: StoredUserData }> {
		const file = await readJsonFile<UserDataFile>(filePath, empty());
		const row = file.users.find((u) => u.userId === userId);
		if (!row) throw new ProviderError(`User-data row "${userId}" not found`, 404);
		return { file, row };
	}

	return {
		async ensure(userId) {
			const file = await readJsonFile<UserDataFile>(filePath, empty());
			if (file.users.some((u) => u.userId === userId)) return;
			file.users.push(emptyRow(userId));
			await writeJsonFile(filePath, file);
		},

		async findById(userId) {
			const { users } = await readJsonFile<UserDataFile>(filePath, empty());
			return users.find((u) => u.userId === userId) ?? null;
		},

		async listAll() {
			const { users } = await readJsonFile<UserDataFile>(filePath, empty());
			return users;
		},

		async updatePermissions(userId, permissions) {
			const { file, row } = await findOrThrow(userId);
			row.platformPermissions = permissions;
			await writeJsonFile(filePath, file);
		},

		async updateDisplayName(userId, displayName) {
			const { file, row } = await findOrThrow(userId);
			if (displayName === undefined) {
				delete row.displayName;
			} else {
				row.displayName = displayName;
			}
			await writeJsonFile(filePath, file);
		},

		async starDefinition(userId, definitionId) {
			const { file, row } = await findOrThrow(userId);
			if (!row.starredDefinitions.includes(definitionId)) {
				row.starredDefinitions.push(definitionId);
				await writeJsonFile(filePath, file);
			}
		},

		async unstarDefinition(userId, definitionId) {
			const { file, row } = await findOrThrow(userId);
			row.starredDefinitions = row.starredDefinitions.filter((d) => d !== definitionId);
			await writeJsonFile(filePath, file);
		},

		async recordRun(userId, run) {
			const { file, row } = await findOrThrow(userId);
			// Remove older entry for same definition, then prepend newest.
			row.recentRuns = [
				run,
				...row.recentRuns.filter((r) => r.definitionId !== run.definitionId)
			].slice(0, MAX_RECENT_RUNS);
			await writeJsonFile(filePath, file);
		},

		async deleteUser(userId) {
			const file = await readJsonFile<UserDataFile>(filePath, empty());
			const before = file.users.length;
			file.users = file.users.filter((u) => u.userId !== userId);
			if (file.users.length === before) {
				throw new ProviderError(`User-data row "${userId}" not found`, 404);
			}
			await writeJsonFile(filePath, file);
		}
	};
}
