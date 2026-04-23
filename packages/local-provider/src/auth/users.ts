import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { ProviderError } from '@selva/platform';
import type { Permission } from '@selva/platform';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

export type { Permission };

export interface StoredUser {
	id: string;
	email: string;
	displayName?: string;
	permissions: Permission[];
	/**
	 * "pbkdf2:sha256:<iterations>:<salt>:<hash>" — all binary values base64url encoded.
	 * Null for OAuth-only users (allowlisted email, no password stored).
	 */
	passwordHash: string | null;
	/** Definition GUIDs pinned by this user. */
	starredDefinitions: string[];
	/** Last N solve runs, newest first. Capped at MAX_RECENT_RUNS. */
	recentRuns: import('@selva/platform').RecentRun[];
	createdAt: string; // ISO 8601
}

const MAX_RECENT_RUNS = 20;

export interface UsersFile {
	users: StoredUser[];
}

// ── PBKDF2 password hashing ───────────────────────────────────────────────

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

// ── CRUD ────────────────────────────────────────────────────────────────────

const EMPTY_USERS: UsersFile = { users: [] };

export interface LocalUserMetaProvider {
	findByEmail(email: string): Promise<StoredUser | null>;
	findById(id: string): Promise<StoredUser | null>;
	listUsers(): Promise<Omit<StoredUser, 'passwordHash'>[]>;
	/** password null = OAuth allowlist entry (no password stored) */
	createUser(
		email: string,
		password: string | null,
		permissions: Permission[],
		displayName?: string
	): Promise<StoredUser>;
	updatePermissions(id: string, permissions: Permission[]): Promise<void>;
	updateProfile(id: string, patch: { displayName?: string }): Promise<void>;
	starDefinition(id: string, definitionId: string): Promise<void>;
	unstarDefinition(id: string, definitionId: string): Promise<void>;
	recordRun(id: string, run: import('@selva/platform').RecentRun): Promise<void>;
	deleteUser(id: string): Promise<void>;
}

function backfillUser(u: StoredUser): StoredUser {
	if (!u.starredDefinitions) u.starredDefinitions = [];
	if (!u.recentRuns) u.recentRuns = [];
	return u;
}

export function createLocalUserMetaProvider(usersFilePath: string): LocalUserMetaProvider {
	return {
		async findByEmail(email) {
			const { users } = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const u = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
			return u ? backfillUser(u) : null;
		},

		async findById(id) {
			const { users } = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const u = users.find((u) => u.id === id);
			return u ? backfillUser(u) : null;
		},

		async listUsers() {
			const { users } = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			return users.map((u) => {
				const { passwordHash: _ph, ...rest } = backfillUser(u);
				return rest;
			});
		},

		async createUser(email, password, permissions, displayName?) {
			const file = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			if (file.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
				throw new ProviderError(`User with email "${email}" already exists`, 409);
			}
			const user: StoredUser = {
				id: randomUUID(),
				email,
				...(displayName && { displayName }),
				permissions,
				passwordHash: password !== null ? await hashPassword(password) : null,
				starredDefinitions: [],
				recentRuns: [],
				createdAt: new Date().toISOString()
			};
			file.users.push(user);
			await writeJsonFile(usersFilePath, file);
			return user;
		},

		async updatePermissions(id, permissions) {
			const file = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			user.permissions = permissions;
			await writeJsonFile(usersFilePath, file);
		},

		async updateProfile(id, patch) {
			const file = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			if (patch.displayName !== undefined) user.displayName = patch.displayName;
			await writeJsonFile(usersFilePath, file);
		},

		async starDefinition(id, definitionId) {
			const file = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			if (!user.starredDefinitions) user.starredDefinitions = [];
			if (!user.starredDefinitions.includes(definitionId)) {
				user.starredDefinitions.push(definitionId);
				await writeJsonFile(usersFilePath, file);
			}
		},

		async unstarDefinition(id, definitionId) {
			const file = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			user.starredDefinitions = (user.starredDefinitions ?? []).filter((d) => d !== definitionId);
			await writeJsonFile(usersFilePath, file);
		},

		async recordRun(id, run) {
			const file = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			if (!user.recentRuns) user.recentRuns = [];
			// Remove older entry for same definition, then prepend newest
			user.recentRuns = [run, ...user.recentRuns.filter((r) => r.definitionId !== run.definitionId)].slice(0, MAX_RECENT_RUNS);
			await writeJsonFile(usersFilePath, file);
		},

		async deleteUser(id) {
			const file = await readJsonFile<UsersFile>(usersFilePath, EMPTY_USERS);
			const before = file.users.length;
			file.users = file.users.filter((u) => u.id !== id);
			if (file.users.length === before) throw new ProviderError(`User "${id}" not found`, 404);
			await writeJsonFile(usersFilePath, file);
		}
	};
}
