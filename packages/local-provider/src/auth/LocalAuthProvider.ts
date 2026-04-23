import { timingSafeEqual } from 'node:crypto';
import * as path from 'node:path';
import type { IAuthProvider, AuthUser, Permission, UserManagementResult, RecentRun } from '@selva/platform';
import { ALL_PERMISSIONS, ProviderError } from '@selva/platform';
import { signHmacToken, verifyHmacToken } from './hmac.js';
import { verifyPasswordHash, createLocalUserMetaProvider } from './users.js';
import type { LocalUserMetaProvider, StoredUser } from './users.js';
import { paginate } from '../pagination.js';
import type { ListOptions, Page } from '@selva/platform';

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

const FALLBACK_ADMIN_ID = 'local-admin';

function toAuthUser(u: Pick<StoredUser, 'id' | 'email' | 'displayName' | 'permissions' | 'starredDefinitions' | 'recentRuns'>): AuthUser {
	return {
		id: u.id,
		email: u.email,
		displayName: u.displayName,
		permissions: u.permissions,
		starredDefinitions: u.starredDefinitions,
		recentRuns: u.recentRuns
	};
}

export interface LocalAuthProviderConfig {
	/** HMAC signing secret. Pass from env (SESSION_SECRET). */
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

	readonly capabilities = {
		name: 'Local',
		userCreation: 'email-password',
		selfRegistration: false,
		passwordReset: false,
	} as const;

	constructor(config: LocalAuthProviderConfig) {
		this.hmacSecret = config.hmacSecret;
		this.fallbackAdminPassword = config.fallbackAdminPassword;
		if (config.usersFilePath) {
			this.users = createLocalUserMetaProvider(config.usersFilePath);
		}
	}

	static fromEnv(env: Record<string, string | undefined>): LocalAuthProvider {
		const hmacSecret = env.SESSION_SECRET || env.ADMIN_PASSWORD;
		if (!hmacSecret)
			throw new Error('Missing required env var: SESSION_SECRET (or ADMIN_PASSWORD for dev)');
		return new LocalAuthProvider({
			hmacSecret,
			usersFilePath: env.DATA_PATH ? path.join(env.DATA_PATH, 'users.json') : undefined,
			fallbackAdminPassword: env.ADMIN_PASSWORD
		});
	}

	/**
	 * Verify an HMAC session token.
	 *
	 * The token payload carries the userId so we can look up the live user
	 * record — permissions changes take effect on the next request, not
	 * just at the next login.
	 */
	async verifyToken(token: string): Promise<AuthUser | null> {
		const { valid, userId } = verifyHmacToken(token, this.hmacSecret);
		if (!valid) return null;

		// Fallback admin (single-password mode, no users.json)
		if (userId === FALLBACK_ADMIN_ID) {
			return { id: FALLBACK_ADMIN_ID, permissions: [...ALL_PERMISSIONS], starredDefinitions: [], recentRuns: [] };
		}

		// Look up live user record so permission changes are reflected immediately
		if (this.users) {
			const u = await this.users.findById(userId);
			if (u) return toAuthUser(u);
		}

		return null;
	}

	async createSessionToken(user: AuthUser): Promise<string> {
		return signHmacToken(this.hmacSecret, user.id, SESSION_MAX_AGE_MS);
	}

	async verifyLoginCredentials(email: string, password: string): Promise<AuthUser | null> {
		// Check users.json first
		if (this.users) {
			const user = await this.users.findByEmail(email);
			if (user && user.passwordHash && (await verifyPasswordHash(password, user.passwordHash))) {
				return toAuthUser(user);
			}
		}

		// Fallback: single admin password (no email required)
		if (this.fallbackAdminPassword) {
			const a = Buffer.from(password);
			const b = Buffer.from(this.fallbackAdminPassword);
			if (a.length === b.length && timingSafeEqual(a, b)) {
				return { id: FALLBACK_ADMIN_ID, permissions: [...ALL_PERMISSIONS], starredDefinitions: [], recentRuns: [] };
			}
		}

		return null;
	}

	async getUser(id: string): Promise<AuthUser | null> {
		if (this.users) {
			const u = await this.users.findById(id);
			if (u) return toAuthUser(u);
		}
		if (id === FALLBACK_ADMIN_ID) {
			return { id: FALLBACK_ADMIN_ID, permissions: [...ALL_PERMISSIONS], starredDefinitions: [], recentRuns: [] };
		}
		return null;
	}

	async listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null> {
		if (!this.users) return null;
		const users = await this.users.listUsers();
		return paginate(users.map(toAuthUser), opts);
	}

	async createUser(
		email: string,
		password: string | null,
		permissions: Permission[]
	): Promise<AuthUser | null> {
		if (!this.users) return null;
		return toAuthUser(await this.users.createUser(email, password, permissions));
	}

	async registerUser(email: string, password: string): Promise<AuthUser | null> {
		if (!this.users) return null;
		return toAuthUser(await this.users.createUser(email, password, []));
	}

	async updateUserPermissions(id: string, permissions: Permission[]): Promise<UserManagementResult> {
		if (!this.users) return 'not_supported';
		try {
			await this.users.updatePermissions(id, permissions);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async deleteUser(id: string): Promise<UserManagementResult> {
		if (!this.users) return 'not_supported';
		try {
			await this.users.deleteUser(id);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async updateUserProfile(
		id: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult> {
		if (!this.users) return 'not_supported';
		try {
			await this.users.updateProfile(id, patch);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async starDefinition(userId: string, definitionId: string): Promise<UserManagementResult> {
		if (!this.users) return 'not_supported';
		try {
			await this.users.starDefinition(userId, definitionId);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async unstarDefinition(userId: string, definitionId: string): Promise<UserManagementResult> {
		if (!this.users) return 'not_supported';
		try {
			await this.users.unstarDefinition(userId, definitionId);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async recordRun(userId: string, run: RecentRun): Promise<UserManagementResult> {
		if (!this.users) return 'not_supported';
		try {
			await this.users.recordRun(userId, run);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async requestPasswordReset(_email: string): Promise<UserManagementResult> {
		// Local provider doesn't implement password reset emails.
		// For production, implement via email service (SendGrid, AWS SES, etc.)
		return 'not_supported';
	}

	async completePasswordReset(_token: string, _newPassword: string): Promise<UserManagementResult> {
		// Local provider doesn't implement password reset token validation.
		// For production, implement via email service or your own token store.
		return 'not_supported';
	}
}
