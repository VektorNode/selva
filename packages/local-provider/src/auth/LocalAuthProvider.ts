import * as path from 'node:path';
import type {
	IAuthProvider,
	IPasswordAuth,
	AuthUser,
	LoginResult,
	UserManagementResult,
	ListOptions,
	Page
} from '@selvajs/platform';
import { ProviderError } from '@selvajs/platform';
import { signHmacToken, verifyHmacToken } from './hmac.js';
import { verifyPasswordHash, createLocalAuthUserStore } from './users.js';
import type { LocalAuthUserStore, StoredAuthUser } from './users.js';
import { paginate } from '../data/pagination.js';

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

function toAuthUser(
	u: Pick<StoredAuthUser, 'id' | 'email' | 'createdAt' | 'lastLoginAt' | 'disabled'>
): AuthUser {
	return {
		id: u.id,
		email: u.email,
		createdAt: u.createdAt,
		lastLoginAt: u.lastLoginAt,
		disabled: u.disabled
	};
}

export interface LocalAuthProviderConfig {
	/** HMAC signing secret. Pass from env (SESSION_SECRET). */
	hmacSecret: string;
	/**
	 * Absolute path to auth-users.json — identity-only storage. Per-user app
	 * state (permissions, profile, starred defs, recent runs) lives in
	 * `user-data.json`, owned by `LocalDataProvider`. The two files key on
	 * the same user ID and are written independently.
	 */
	usersFilePath?: string;
}

class LocalPasswordAuth implements IPasswordAuth {
	constructor(
		private readonly users: LocalAuthUserStore | undefined,
		private readonly mintToken: (user: AuthUser) => string
	) {}

	async verifyLogin(email: string, password: string): Promise<LoginResult> {
		if (!this.users) return { kind: 'failed', reason: 'invalid_credentials' };
		const user = await this.users.findByEmail(email);
		if (!user) return { kind: 'failed', reason: 'invalid_credentials' };
		if (user.disabled) return { kind: 'failed', reason: 'disabled' };
		if (!user.passwordHash || !(await verifyPasswordHash(password, user.passwordHash))) {
			return { kind: 'failed', reason: 'invalid_credentials' };
		}
		await this.users.touchLastLogin(user.id).catch(() => {});
		const auth = toAuthUser(user);
		return { kind: 'success', user: auth, sessionToken: this.mintToken(auth) };
	}

	async createUserWithPassword(email: string, password: string): Promise<AuthUser> {
		if (!this.users) {
			throw new ProviderError(
				'createUserWithPassword requires a users.json backend (DATA_PATH)',
				500
			);
		}
		// Identity-only — platform permissions and the user-data row are seeded
		// separately via `IDataProvider.ensureUser` + `IPlatformPermissionStore.set`.
		return toAuthUser(await this.users.createUser(email, password));
	}

	async registerUser(email: string, password: string): Promise<AuthUser | null> {
		if (!this.users) return null;
		return toAuthUser(await this.users.createUser(email, password));
	}
}

export class LocalAuthProvider implements IAuthProvider {
	private readonly hmacSecret: string;
	private readonly users?: LocalAuthUserStore;

	readonly name = 'Local';
	readonly passwordAuth: IPasswordAuth;

	constructor(config: LocalAuthProviderConfig) {
		this.hmacSecret = config.hmacSecret;
		if (config.usersFilePath) {
			this.users = createLocalAuthUserStore(config.usersFilePath);
		}
		this.passwordAuth = new LocalPasswordAuth(this.users, (user) =>
			signHmacToken(this.hmacSecret, user.id, SESSION_MAX_AGE_MS)
		);
	}

	static fromEnv(env: Record<string, string | undefined>): LocalAuthProvider {
		const hmacSecret = env.SESSION_SECRET;
		if (!hmacSecret) throw new Error('Missing required env var: SESSION_SECRET');
		return new LocalAuthProvider({
			hmacSecret,
			usersFilePath: env.DATA_PATH ? path.join(env.DATA_PATH, 'auth-users.json') : undefined
		});
	}

	/** Verify an HMAC session token and return the live user record. */
	async verifyToken(token: string): Promise<AuthUser | null> {
		const { valid, userId } = verifyHmacToken(token, this.hmacSecret);
		if (!valid) return null;
		if (!this.users) return null;
		const u = await this.users.findById(userId);
		if (!u || u.disabled) return null;
		await this.users.touchLastLogin(u.id).catch(() => {});
		return toAuthUser(u);
	}

	async touchLastLogin(id: string): Promise<void> {
		if (!this.users) return;
		await this.users.touchLastLogin(id);
	}

	async getUser(id: string): Promise<AuthUser | null> {
		if (!this.users) return null;
		const u = await this.users.findById(id);
		return u ? toAuthUser(u) : null;
	}

	async listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null> {
		if (!this.users) return null;
		const users = await this.users.listUsers();
		return paginate(users.map(toAuthUser), opts);
	}

	async deleteUser(id: string): Promise<UserManagementResult> {
		// Identity-only delete. The §2 sole-`instance_admin` invariant is
		// enforced by the caller via `IPlatformPermissionStore.countInstanceAdminsExcluding`
		// before this method is called. The caller is also responsible for
		// removing the user-data row via `LocalDataProvider`'s cascade hook.
		if (!this.users) return 'not_supported';
		const target = await this.users.findById(id);
		if (!target) return 'not_found';
		try {
			await this.users.deleteUser(id);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async disableUser(id: string): Promise<UserManagementResult> {
		// Identity-only disable. The §2 sole-`instance_admin` invariant is
		// enforced by the caller, same as `deleteUser`.
		if (!this.users) return 'not_supported';
		const target = await this.users.findById(id);
		if (!target) return 'not_found';
		try {
			await this.users.setDisabled(id, true);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}
}
