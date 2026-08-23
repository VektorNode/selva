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

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

// Mirrors `MIN_TOKEN_SECRET_LENGTH` (share/invite tokens) and the 32-byte
// `SELVA_AT_REST_KEY` rule so a weak session secret can't reach prod. Duplicated
// rather than imported — the local provider has no `@selvajs/server` dependency.
const MIN_HMAC_SECRET_LENGTH = 32;

// The `.env.example` placeholder is 41 chars, so it clears the length guard
// above. An operator who copies the file without rotating boots with a signing
// key that is public in the repo — every session token forgeable. `selva
// doctor` catches it, but nothing forces anyone to run doctor.
export const PLACEHOLDER_SECRET = 'replace-this-with-a-random-32-byte-hex-key';

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
	/** HMAC signing secret. Pass from env (SELVA_HMAC_KEY). */
	hmacSecret: string;
	/** Absolute path to auth-users.json. Omit for stateless (no-DATA_PATH) mode. */
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
		// Permissions and the user-data row are seeded separately, via
		// `IDataProvider.ensureUser` + `IPlatformPermissionStore.set`.
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

	/**
	 * The underlying identity store, or undefined in stateless (no-DATA_PATH)
	 * mode. Exposed so callers needing direct seed/read access (tests, advanced
	 * wiring) share this provider's store — and its cache — instead of
	 * constructing a second store on the same file, which would diverge from it.
	 */
	get userStore(): LocalAuthUserStore | undefined {
		return this.users;
	}

	static fromEnv(env: Record<string, string | undefined>): LocalAuthProvider {
		const hmacSecret = env.SELVA_HMAC_KEY;
		if (!hmacSecret) throw new Error('Missing required env var: SELVA_HMAC_KEY');
		if (hmacSecret === PLACEHOLDER_SECRET) {
			throw new Error(
				'SELVA_HMAC_KEY is still the .env.example placeholder — every session token ' +
					'would be forgeable by anyone with the repo. Generate one with: openssl rand -hex 32'
			);
		}
		if (hmacSecret.length < MIN_HMAC_SECRET_LENGTH) {
			throw new Error(
				`SELVA_HMAC_KEY must be at least ${MIN_HMAC_SECRET_LENGTH} characters ` +
					`(got ${hmacSecret.length}). Generate one with: openssl rand -base64 32`
			);
		}
		return new LocalAuthProvider({
			hmacSecret,
			usersFilePath: env.DATA_PATH ? path.join(env.DATA_PATH, 'auth-users.json') : undefined
		});
	}

	/**
	 * Runs on every authenticated request, so it stays read-only: one cached
	 * `findById`, no writes. `lastLoginAt` is stamped at login time in
	 * `verifyLogin`, not here — the only consumers treat it as a
	 * has-ever-signed-in flag (invited vs. active in admin/team lists), not a
	 * per-request activity clock, so a write on every request would cost a
	 * full file read+parse just to usually decide not to write.
	 */
	async verifyToken(token: string): Promise<AuthUser | null> {
		const { valid, userId } = verifyHmacToken(token, this.hmacSecret);
		if (!valid) return null;
		if (!this.users) return null;
		const u = await this.users.findById(userId);
		if (!u || u.disabled) return null;
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
		// Identity-only delete. The caller enforces the sole-instance_admin
		// invariant via `IPlatformPermissionStore.countInstanceAdminsExcluding`
		// before calling this, and removes the user-data row via
		// `LocalDataProvider`'s cascade hook.
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
		// Identity-only disable. Same sole-instance_admin invariant as `deleteUser`, enforced by the caller.
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
