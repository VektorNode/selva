import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { ProviderError } from '@selva/platform';

export type UserRole = 'platform_admin' | 'user';

export interface StoredUser {
	id: string;
	email: string;
	displayName?: string;
	role: UserRole;
	/**
	 * Password hash in format: "pbkdf2:sha256:<iterations>:<salt>:<hash>"
	 * All binary values are base64url encoded.
	 */
	passwordHash: string;
	createdAt: string; // ISO 8601
}

export interface UsersFile {
	users: StoredUser[];
}

// ── PBKDF2 password hashing ────────────────────────────────────────────────
// Uses Node.js built-in crypto — no extra dependencies.

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(16).toString('base64url');
	const hash = await new Promise<Buffer>((resolve, reject) =>
		crypto.pbkdf2(
			password,
			salt,
			PBKDF2_ITERATIONS,
			PBKDF2_KEYLEN,
			PBKDF2_DIGEST,
			(err, key) => (err ? reject(err) : resolve(key))
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

// ── File I/O ────────────────────────────────────────────────────────────────

async function readUsersFile(usersPath: string): Promise<UsersFile> {
	try {
		const raw = await fs.readFile(usersPath, 'utf-8');
		return JSON.parse(raw) as UsersFile;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return { users: [] };
		}
		throw err;
	}
}

async function writeUsersFile(usersPath: string, data: UsersFile): Promise<void> {
	const tmp = `${usersPath}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(data, null, '\t'), 'utf-8');
	await fs.rename(tmp, usersPath);
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export interface LocalUserMetaProvider {
	findByEmail(email: string): Promise<StoredUser | null>;
	findById(id: string): Promise<StoredUser | null>;
	listUsers(): Promise<Omit<StoredUser, 'passwordHash'>[]>;
	createUser(email: string, password: string, role: UserRole, displayName?: string): Promise<StoredUser>;
	updateRole(id: string, role: UserRole): Promise<void>;
	deleteUser(id: string): Promise<void>;
}

export function createLocalUserMetaProvider(usersFilePath: string): LocalUserMetaProvider {
	return {
		async findByEmail(email) {
			const { users } = await readUsersFile(usersFilePath);
			return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
		},

		async findById(id) {
			const { users } = await readUsersFile(usersFilePath);
			return users.find((u) => u.id === id) ?? null;
		},

		async listUsers() {
			const { users } = await readUsersFile(usersFilePath);
			// Strip passwordHash before returning
			return users.map(({ passwordHash: _ph, ...rest }) => rest);
		},

		async createUser(email, password, role, displayName?) {
			const file = await readUsersFile(usersFilePath);
			if (file.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
				throw new ProviderError(`User with email "${email}" already exists`, 409);
			}
			const user: StoredUser = {
				id: randomUUID(),
				email,
				...(displayName && { displayName }),
				role,
				passwordHash: await hashPassword(password),
				createdAt: new Date().toISOString()
			};
			file.users.push(user);
			await writeUsersFile(usersFilePath, file);
			return user;
		},

		async updateRole(id, role) {
			const file = await readUsersFile(usersFilePath);
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			user.role = role;
			await writeUsersFile(usersFilePath, file);
		},

		async deleteUser(id) {
			const file = await readUsersFile(usersFilePath);
			const before = file.users.length;
			file.users = file.users.filter((u) => u.id !== id);
			if (file.users.length === before) throw new ProviderError(`User "${id}" not found`, 404);
			await writeUsersFile(usersFilePath, file);
		}
	};
}
