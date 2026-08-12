import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { ProviderError } from '@selvajs/platform';
import { readJsonFile, writeJsonFile } from '../data/fsJson.js';

/**
 * Identity-only on-disk shape. Per-user app state (permissions, profile,
 * starred definitions, recent runs) lives in `user-data.json`, owned by
 * `LocalDataProvider`. The split lets `LocalAuthProvider` pair with any data
 * provider, and any auth provider pair with `LocalDataProvider`, without one
 * stepping on the other.
 */
export interface StoredAuthUser {
	id: string;
	email: string;
	/**
	 * "pbkdf2:sha256:<iterations>:<salt>:<hash>", binary values base64url encoded.
	 * Null for OAuth-only users (allowlisted email, no password stored).
	 */
	passwordHash: string | null;
	createdAt: string; // ISO 8601
	/** ISO 8601, most recent successful login. */
	lastLoginAt?: string;
	/** True means the provider refuses to authenticate this user. */
	disabled?: boolean;
}

/** Debounce window for lastLoginAt writes — skip if prior stamp is newer than this. */
const LAST_LOGIN_DEBOUNCE_MS = 60_000;

export interface AuthUsersFile {
	users: StoredAuthUser[];
}

// ============================================================================
// PBKDF2 password hashing
// ============================================================================
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(16).toString('base64url');
	const hash = await new Promise<Buffer>((resolve, reject) =>
		crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST, (err, key) =>
			err ? reject(err) : resolve(key)
		)
	);
	return `pbkdf2:${PBKDF2_DIGEST}:${PBKDF2_ITERATIONS}:${salt}:${hash.toString('base64url')}`;
}

export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
	const parts = storedHash.split(':');
	if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
	const [, digest, iterStr, salt, expectedHashB64] = parts;
	const iterations = parseInt(iterStr, 10);
	if (!Number.isFinite(iterations) || iterations <= 0) return false;

	const expected = Buffer.from(expectedHashB64, 'base64url');
	const actual = await new Promise<Buffer>((resolve, reject) =>
		crypto.pbkdf2(password, salt, iterations, PBKDF2_KEYLEN, digest, (err, key) =>
			err ? reject(err) : resolve(key)
		)
	);

	if (actual.length !== expected.length) return false;
	return crypto.timingSafeEqual(actual, expected);
}

// ============================================================================
// CRUD
// ============================================================================
// Fresh object per call — `readJsonFile` returns its fallback by reference
// when the file is missing, so a shared singleton would let one test (or
// one process write) mutate state visible to the next read.
const empty = (): AuthUsersFile => ({ users: [] });

export interface LocalAuthUserStore {
	findByEmail(email: string): Promise<StoredAuthUser | null>;
	findById(id: string): Promise<StoredAuthUser | null>;
	listUsers(): Promise<Omit<StoredAuthUser, 'passwordHash'>[]>;
	/** password null = OAuth allowlist entry (no password stored) */
	createUser(email: string, password: string | null): Promise<StoredAuthUser>;
	setDisabled(id: string, disabled: boolean): Promise<void>;
	touchLastLogin(id: string): Promise<void>;
	deleteUser(id: string): Promise<void>;
}

export function createLocalAuthUserStore(usersFilePath: string): LocalAuthUserStore {
	// Load-once, write-through cache, same pattern as `LocalOrgStoreLoader`:
	// reading and parsing the whole file on every call is the hot-path cost,
	// since `auth-users.json` is read on every authenticated request. The
	// provider is the sole writer in single-process local mode, so the
	// in-memory copy stays authoritative — every mutation updates the cache and
	// persists via temp+rename. Concurrent first callers share one in-flight
	// load so writes stack on the same array.
	let cache: AuthUsersFile | null = null;
	let loading: Promise<AuthUsersFile> | null = null;

	async function load(): Promise<AuthUsersFile> {
		if (cache) return cache;
		loading ??= readJsonFile<AuthUsersFile>(usersFilePath, empty()).then((data) => {
			cache = data;
			loading = null;
			return data;
		});
		return loading;
	}

	async function persist(file: AuthUsersFile): Promise<void> {
		cache = file;
		await writeJsonFile(usersFilePath, file);
	}

	return {
		async findByEmail(email) {
			const { users } = await load();
			return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
		},

		async findById(id) {
			const { users } = await load();
			return users.find((u) => u.id === id) ?? null;
		},

		async listUsers() {
			const { users } = await load();
			return users.map(({ passwordHash: _ph, ...rest }) => rest);
		},

		async createUser(email, password) {
			const file = await load();
			if (file.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
				throw new ProviderError(`User with email "${email}" already exists`, 409);
			}
			const user: StoredAuthUser = {
				id: randomUUID(),
				email,
				passwordHash: password !== null ? await hashPassword(password) : null,
				createdAt: new Date().toISOString()
			};
			file.users.push(user);
			await persist(file);
			return user;
		},

		async setDisabled(id, disabled) {
			const file = await load();
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			user.disabled = disabled;
			await persist(file);
		},

		async touchLastLogin(id) {
			const file = await load();
			const user = file.users.find((u) => u.id === id);
			if (!user) return;
			const now = Date.now();
			if (user.lastLoginAt) {
				const prev = Date.parse(user.lastLoginAt);
				if (Number.isFinite(prev) && now - prev < LAST_LOGIN_DEBOUNCE_MS) return;
			}
			user.lastLoginAt = new Date(now).toISOString();
			await persist(file);
		},

		async deleteUser(id) {
			const file = await load();
			const before = file.users.length;
			file.users = file.users.filter((u) => u.id !== id);
			if (file.users.length === before) throw new ProviderError(`User "${id}" not found`, 404);
			await persist(file);
		}
	};
}
