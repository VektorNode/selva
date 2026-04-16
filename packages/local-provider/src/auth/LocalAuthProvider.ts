import { timingSafeEqual } from 'node:crypto';
import type { IAuthProvider, AuthUser, UserRole } from '@selva/platform/auth';
import { signHmacToken, verifyHmacToken } from './hmac.js';
import { verifyPasswordHash, createLocalUserMetaProvider } from './users.js';
import type { LocalUserMetaProvider } from './users.js';

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface LocalAuthProviderConfig {
	/** HMAC signing secret. Pass from env (SESSION_SECRET or ADMIN_PASSWORD). */
	hmacSecret: string;
	/**
	 * Absolute path to users.json.
	 * When provided, login authenticates against users in this file.
	 * When omitted, only fallbackAdminPassword is checked.
	 */
	usersFilePath?: string;
	/**
	 * Single-user fallback password (plain text).
	 * Used when usersFilePath is not set or no matching user is found.
	 * Maintains backward compatibility with the original ADMIN_PASSWORD behavior.
	 */
	fallbackAdminPassword?: string;
}

export class LocalAuthProvider implements IAuthProvider {
	private readonly hmacSecret: string;
	private readonly users?: LocalUserMetaProvider;
	private readonly fallbackAdminPassword?: string;

	constructor(config: LocalAuthProviderConfig) {
		this.hmacSecret = config.hmacSecret;
		this.fallbackAdminPassword = config.fallbackAdminPassword;
		if (config.usersFilePath) {
			this.users = createLocalUserMetaProvider(config.usersFilePath);
		}
	}

	/**
	 * Verify an HMAC session token (the raw cookie value).
	 * Returns the authenticated user, or null if the token is invalid or expired.
	 *
	 * TODO(multi-user): The token currently carries only an expiry — no user identity.
	 * To support per-user sessions, encode the user ID in the token payload and decode
	 * it here to return the correct AuthUser.
	 */
	async verifyToken(token: string): Promise<AuthUser | null> {
		if (!verifyHmacToken(token, this.hmacSecret)) return null;
		return { id: 'local-admin', role: 'admin' };
	}

	async createSessionToken(_user: AuthUser): Promise<string> {
		return signHmacToken(this.hmacSecret, SESSION_MAX_AGE_MS);
	}

	async verifyLoginCredentials(email: string, password: string): Promise<AuthUser | null> {
		// Check users.json first
		if (this.users) {
			const user = await this.users.findByEmail(email);
			if (user && (await verifyPasswordHash(password, user.passwordHash))) {
				return { id: user.id, email: user.email, role: user.role };
			}
		}

		// Fallback: single admin password (no email required)
		if (this.fallbackAdminPassword) {
			const a = Buffer.from(password);
			const b = Buffer.from(this.fallbackAdminPassword);
			if (a.length === b.length && timingSafeEqual(a, b)) {
				return { id: 'local-admin', role: 'admin' };
			}
		}

		return null;
	}

	async getUser(id: string): Promise<AuthUser | null> {
		if (this.users) {
			const u = await this.users.findById(id);
			if (u) return { id: u.id, email: u.email, role: u.role };
		}
		if (id === 'local-admin') {
			return { id: 'local-admin', role: 'admin' };
		}
		return null;
	}

	async listUsers(): Promise<AuthUser[] | null> {
		if (!this.users) return null;
		const users = await this.users.listUsers();
		return users.map((u) => ({ id: u.id, email: u.email, role: u.role }));
	}

	async createUser(email: string, password: string, role: UserRole): Promise<AuthUser | null> {
		if (!this.users) return null;
		const u = await this.users.createUser(email, password, role);
		return { id: u.id, email: u.email, role: u.role };
	}

	async updateUserRole(id: string, role: UserRole): Promise<boolean> {
		if (!this.users) return false;
		try {
			await this.users.updateRole(id, role);
			return true;
		} catch {
			return false;
		}
	}

	async deleteUser(id: string): Promise<boolean> {
		if (!this.users) return false;
		try {
			await this.users.deleteUser(id);
			return true;
		} catch {
			return false;
		}
	}
}
