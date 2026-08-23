import { ProviderError } from '@selvajs/platform';
import type { PlatformPermission, RecentRun } from '@selvajs/platform';
import { readJsonFile, writeJsonFile } from './fsJson.js';

/**
 * Per-user state keyed by the auth provider's user ID. Mirrors
 * `public.user_profiles` in the Supabase schema. **Never holds identity**
 * (email, password hash, createdAt) — that lives with the auth provider.
 *
 * `hooks.server.ts` calls `IDataProvider.ensureUser` once per authenticated
 * request (the local equivalent of Supabase's `handle_new_auth_user`
 * trigger), so every read here after that is guaranteed to find a row.
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
	/** Idempotent: adds an empty row if missing, no-op if present. */
	ensure(userId: string): Promise<void>;
	findById(userId: string): Promise<StoredUserData | null>;
	listAll(): Promise<StoredUserData[]>;
	updatePermissions(userId: string, permissions: PlatformPermission[]): Promise<void>;
	/**
	 * Write `permissions`, but only while the §2 sole-`instance_admin`
	 * invariant still holds — the count and the write happen without an
	 * `await` between them, so two concurrent demotions cannot both observe
	 * the other as "another admin exists".
	 *
	 * Returns `'last_admin'` when the write would drop the final admin,
	 * `'not_found'` for an absent row. Callers must not pre-check the count
	 * themselves: a decision made before this call is exactly the race.
	 */
	updatePermissionsGuarded(
		userId: string,
		permissions: PlatformPermission[]
	): Promise<'ok' | 'last_admin' | 'not_found'>;
	/** Grants only if no user holds `instance_admin` yet. True if this call claimed it. */
	claimFirstInstanceAdminGuarded(
		userId: string,
		permissions: PlatformPermission[]
	): Promise<boolean>;
	updateDisplayName(userId: string, displayName: string | undefined): Promise<void>;
	starDefinition(userId: string, definitionId: string): Promise<void>;
	unstarDefinition(userId: string, definitionId: string): Promise<void>;
	recordRun(userId: string, run: RecentRun): Promise<void>;
	deleteUser(userId: string): Promise<void>;
}

export function createLocalUserDataStore(filePath: string): LocalUserDataStore {
	// Load-once, write-through cache, same pattern as `LocalOrgStoreLoader`.
	// The provider is the sole writer in single-process local mode, so the
	// in-memory copy is authoritative — but only if every consumer shares one
	// instance. LocalDataProvider injects a single instance across the
	// profile, permission, and data-provider views; don't call this factory
	// more than once per process.
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

	// Serializes permission writes that must not interleave. Single-process
	// only, like the cache above — it makes the local provider's own
	// concurrency safe, not a multi-process deployment's. That is the same
	// dev-scale boundary the load-once cache already draws.
	let permissionLock: Promise<unknown> = Promise.resolve();

	function withPermissionLock<T>(fn: () => Promise<T>): Promise<T> {
		// Chain onto the tail regardless of how the previous holder settled, so
		// one rejection cannot wedge the queue for the process's lifetime.
		const next = permissionLock.then(fn, fn);
		permissionLock = next.catch(() => {});
		return next;
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

		async updatePermissionsGuarded(userId, permissions) {
			// Serialized against every other guarded write: `load()` may yield,
			// and the admin count read before that yield is stale by the time
			// the write lands. Queueing keeps count-and-write indivisible.
			return withPermissionLock(async () => {
				const file = await load();
				const row = file.users.find((u) => u.userId === userId);
				if (!row) return 'not_found';

				const wasAdmin = row.platformPermissions.includes('instance_admin');
				const willBeAdmin = permissions.includes('instance_admin');
				if (wasAdmin && !willBeAdmin) {
					const others = file.users.filter(
						(u) => u.userId !== userId && u.platformPermissions.includes('instance_admin')
					).length;
					if (others === 0) return 'last_admin';
				}

				row.platformPermissions = permissions;
				await persist(file);
				return 'ok';
			});
		},

		async claimFirstInstanceAdminGuarded(userId, permissions) {
			// Shares the lock with `updatePermissionsGuarded` deliberately: the
			// two decide the same question from opposite ends ("is there still an
			// admin" / "is there one yet"), so they must not interleave with each
			// other any more than with themselves.
			return withPermissionLock(async () => {
				const file = await load();
				if (file.users.some((u) => u.platformPermissions.includes('instance_admin'))) {
					return false;
				}
				const row = file.users.find((u) => u.userId === userId);
				if (!row) return false;

				row.platformPermissions = permissions;
				await persist(file);
				return true;
			});
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
