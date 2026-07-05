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
	// Load-once, write-through cache — same pattern as `LocalOrgStoreLoader` /
	// the auth-users store. `user-data.json` is read ~4× per authenticated
	// request (ensureUser, getProfile, getFor + the hook bootstrap). The provider
	// is the sole writer in single-process local mode, so the in-memory copy is
	// authoritative. MUST be a single shared instance across the profile,
	// permission, and data-provider views (LocalDataProvider injects one) — see
	// those constructors. §3a.
	let cache: UserDataFile | null = null;
	let loading: Promise<UserDataFile> | null = null;

	async function load(): Promise<UserDataFile> {
		if (cache) return cache;
		loading ??= readJsonFile<UserDataFile>(filePath, empty()).then((data) => {
			cache = data;
			loading = null;
			return data;
		});
		return loading;
	}

	async function persist(file: UserDataFile): Promise<void> {
		cache = file;
		await writeJsonFile(filePath, file);
	}

	async function findOrThrow(userId: string): Promise<{ file: UserDataFile; row: StoredUserData }> {
		const file = await load();
		const row = file.users.find((u) => u.userId === userId);
		if (!row) throw new ProviderError(`User-data row "${userId}" not found`, 404);
		return { file, row };
	}

	return {
		async ensure(userId) {
			const file = await load();
			if (file.users.some((u) => u.userId === userId)) return;
			file.users.push(emptyRow(userId));
			await persist(file);
		},

		async findById(userId) {
			const { users } = await load();
			return users.find((u) => u.userId === userId) ?? null;
		},

		async listAll() {
			const { users } = await load();
			return users;
		},

		async updatePermissions(userId, permissions) {
			const { file, row } = await findOrThrow(userId);
			row.platformPermissions = permissions;
			await persist(file);
		},

		async updateDisplayName(userId, displayName) {
			const { file, row } = await findOrThrow(userId);
			if (displayName === undefined) {
				delete row.displayName;
			} else {
				row.displayName = displayName;
			}
			await persist(file);
		},

		async starDefinition(userId, definitionId) {
			const { file, row } = await findOrThrow(userId);
			if (!row.starredDefinitions.includes(definitionId)) {
				row.starredDefinitions.push(definitionId);
				await persist(file);
			}
		},

		async unstarDefinition(userId, definitionId) {
			const { file, row } = await findOrThrow(userId);
			row.starredDefinitions = row.starredDefinitions.filter((d) => d !== definitionId);
			await persist(file);
		},

		async recordRun(userId, run) {
			const { file, row } = await findOrThrow(userId);
			// Remove older entry for same definition, then prepend newest.
			row.recentRuns = [
				run,
				...row.recentRuns.filter((r) => r.definitionId !== run.definitionId)
			].slice(0, MAX_RECENT_RUNS);
			await persist(file);
		},

		async deleteUser(userId) {
			const file = await load();
			const before = file.users.length;
			file.users = file.users.filter((u) => u.userId !== userId);
			if (file.users.length === before) {
				throw new ProviderError(`User-data row "${userId}" not found`, 404);
			}
			await persist(file);
		}
	};
}
