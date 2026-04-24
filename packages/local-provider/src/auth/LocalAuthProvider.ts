import { timingSafeEqual } from 'node:crypto';
import * as path from 'node:path';
import type {
	IAuthProvider,
	IPasswordAuth,
	AuthUser,
	LoginResult,
	PlatformPermission,
	UserManagementResult,
	ListOptions,
	Page
} from '@selva/platform';
import { ALL_PLATFORM_PERMISSIONS, ProviderError } from '@selva/platform';
import { signHmacToken, verifyHmacToken } from './hmac.js';
import { verifyPasswordHash, createLocalUserMetaProvider } from './users.js';
import type { LocalUserMetaProvider, StoredUser } from './users.js';
import { paginate } from '../pagination.js';

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

const FALLBACK_ADMIN_ID = 'local-admin';

function toAuthUser(
	u: Pick<
		StoredUser,
		'id' | 'email' | 'platformPermissions' | 'createdAt' | 'lastLoginAt' | 'disabled'
	>
): AuthUser {
	return {
		id: u.id,
		email: u.email,
		platformPermissions: u.platformPermissions,
		createdAt: u.createdAt,
		lastLoginAt: u.lastLoginAt,
		disabled: u.disabled
	};
}

function fallbackAdmin(): AuthUser {
	return {
		id: FALLBACK_ADMIN_ID,
		platformPermissions: [...ALL_PLATFORM_PERMISSIONS]
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
	 */
	fallbackAdminPassword?: string;
}

class LocalPasswordAuth implements IPasswordAuth {
	constructor(
		private readonly users: LocalUserMetaProvider | undefined,
		private readonly fallbackAdminPassword: string | undefined,
		private readonly mintToken: (user: AuthUser) => string
	) {}

	async verifyLogin(email: string, password: string): Promise<LoginResult> {
		if (this.users) {
			const user = await this.users.findByEmail(email);
			if (!user) {
				// Fall through to fallback-admin password below.
			} else if (user.disabled) {
				return { kind: 'failed', reason: 'disabled' };
			} else if (
				user.passwordHash &&
				(await verifyPasswordHash(password, user.passwordHash))
			) {
				await this.users.touchLastLogin(user.id).catch(() => {});
				const auth = toAuthUser(user);
				return { kind: 'success', user: auth, sessionToken: this.mintToken(auth) };
			}
		}
		if (this.fallbackAdminPassword) {
			const a = Buffer.from(password);
			const b = Buffer.from(this.fallbackAdminPassword);
			if (a.length === b.length && timingSafeEqual(a, b)) {
				const auth = fallbackAdmin();
				return { kind: 'success', user: auth, sessionToken: this.mintToken(auth) };
			}
		}
		return { kind: 'failed', reason: 'invalid_credentials' };
	}

	async createUserWithPassword(
		email: string,
		password: string,
		platformPermissions: PlatformPermission[]
	): Promise<AuthUser> {
		if (!this.users) {
			throw new ProviderError(
				'createUserWithPassword requires a users.json backend (DATA_PATH)',
				500
			);
		}
		return toAuthUser(await this.users.createUser(email, password, platformPermissions));
	}

	async registerUser(email: string, password: string): Promise<AuthUser | null> {
		if (!this.users) return null;
		return toAuthUser(await this.users.createUser(email, password, []));
	}
}

export class LocalAuthProvider implements IAuthProvider {
	private readonly hmacSecret: string;
	private readonly users?: LocalUserMetaProvider;

	readonly name = 'Local';
	readonly passwordAuth: IPasswordAuth;

	constructor(config: LocalAuthProviderConfig) {
		this.hmacSecret = config.hmacSecret;
		if (config.usersFilePath) {
			this.users = createLocalUserMetaProvider(config.usersFilePath);
		}
		this.passwordAuth = new LocalPasswordAuth(
			this.users,
			config.fallbackAdminPassword,
			(user) => signHmacToken(this.hmacSecret, user.id, SESSION_MAX_AGE_MS)
		);
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

	/** Verify an HMAC session token and return the live user record. */
	async verifyToken(token: string): Promise<AuthUser | null> {
		const { valid, userId } = verifyHmacToken(token, this.hmacSecret);
		if (!valid) return null;

		if (userId === FALLBACK_ADMIN_ID) return fallbackAdmin();

		if (this.users) {
			const u = await this.users.findById(userId);
			if (u && !u.disabled) {
				await this.users.touchLastLogin(u.id).catch(() => {});
				return toAuthUser(u);
			}
		}
		return null;
	}

	async touchLastLogin(id: string): Promise<void> {
		if (!this.users) return;
		await this.users.touchLastLogin(id);
	}

	async getUser(id: string): Promise<AuthUser | null> {
		if (this.users) {
			const u = await this.users.findById(id);
			if (u) return toAuthUser(u);
		}
		if (id === FALLBACK_ADMIN_ID) return fallbackAdmin();
		return null;
	}

	async listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null> {
		if (!this.users) return null;
		const users = await this.users.listUsers();
		return paginate(users.map(toAuthUser), opts);
	}

	async updateUserPlatformPermissions(
		id: string,
		platformPermissions: PlatformPermission[]
	): Promise<UserManagementResult> {
		if (!this.users) return 'not_supported';
		try {
			await this.users.updatePlatformPermissions(id, platformPermissions);
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
}
