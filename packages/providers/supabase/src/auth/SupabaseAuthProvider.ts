import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NoopLogger, type ILogger } from '@selvajs/platform';
import { DEFAULT_SCHEMA, type SelvaSchemaClient } from '../data/client.js';
import type {
	IAuthProvider,
	IEmailLinkAuth,
	IOAuthAuth,
	IPasswordAuth,
	ISessionRefresh,
	AuthUser,
	LoginResult,
	UserManagementResult,
	ListOptions,
	Page
} from '@selvajs/platform';

/**
 * Auth backed by Supabase Auth (GoTrue). Identity-only — platform permissions
 * live on `IPlatformPermissionStore`, profile state on `IUserProfileStore`.
 */
export interface SupabaseAuthProviderConfig {
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
	/** Allow self-service signup via `passwordAuth.registerUser`. Default false. */
	enableSelfSignup?: boolean;
	/**
	 * OAuth providers enabled in the Supabase dashboard (lowercased: "google",
	 * "github", …), surfaced via `oauth.listProviders()`. Default empty.
	 */
	oauthProviders?: readonly string[];
	/**
	 * Allow `emailLink.sendMagicLink` to create new users on first request.
	 * Default true, matching Supabase's `signInWithOtp` default. Set false for
	 * invite-only deployments; `sendMagicLink` for an unknown email then
	 * returns `{ ok: false, reason: 'signup_disabled' }`.
	 */
	allowEmailLinkSignup?: boolean;
	/**
	 * How `verifyToken` validates session JWTs — see that method for the
	 * rationale. `'hybrid'` (default) verifies locally and rechecks GoTrue
	 * periodically; `'strict'` calls GoTrue on every request.
	 */
	tokenVerification?: 'hybrid' | 'strict';
	/** Recheck window for `'hybrid'` verification, in ms. Default 60s. */
	revalidateMs?: number;
	/**
	 * Sink for best-effort failures the provider swallows rather than throwing
	 * (currently `touchLastLogin`). Defaults to `NoopLogger`. Only identifiers
	 * are ever logged, never payloads.
	 */
	logger?: ILogger;
}

const DEFAULT_REVALIDATE_MS = 60_000;

function parsePositiveInt(raw: string | undefined): number | undefined {
	if (!raw) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

export class SupabaseAuthProvider implements IAuthProvider {
	readonly name = 'Supabase Auth';
	readonly passwordAuth: IPasswordAuth;
	readonly oauth: IOAuthAuth;
	readonly emailLink: IEmailLinkAuth;
	readonly sessionRefresh: ISessionRefresh;

	private readonly admin: SupabaseClient;
	/**
	 * Service-role client pinned to the `selva` schema. `this.admin` stays
	 * unpinned because it only drives `auth.admin.*` (GoTrue's own REST
	 * surface, unaffected by the PostgREST schema setting) — any table read
	 * or write must go through `db` instead.
	 */
	private readonly db: SelvaSchemaClient;
	private readonly anon: SupabaseClient;
	private readonly anonKey: string;
	private readonly supabaseUrl: string;
	private readonly tokenVerification: 'hybrid' | 'strict';
	private readonly revalidateMs: number;
	private readonly logger: ILogger;

	/**
	 * Last GoTrue recheck per session (epoch ms), keyed by JWT `session_id`.
	 * Swept lazily in `markRevalidated` so session churn can't leak memory.
	 * Per-process — multi-instance drift is harmless, each instance rechecks
	 * on its own schedule.
	 */
	private readonly lastRevalidatedAt = new Map<string, number>();

	constructor(config: SupabaseAuthProviderConfig) {
		this.supabaseUrl = config.supabaseUrl;
		this.anonKey = config.anonKey;
		this.tokenVerification = config.tokenVerification ?? 'hybrid';
		this.revalidateMs = config.revalidateMs ?? DEFAULT_REVALIDATE_MS;
		this.logger = config.logger ?? new NoopLogger();
		this.admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		this.db = createClient(config.supabaseUrl, config.serviceRoleKey, {
			db: { schema: DEFAULT_SCHEMA },
			auth: { persistSession: false, autoRefreshToken: false }
		}) as SelvaSchemaClient;
		this.anon = createClient(config.supabaseUrl, config.anonKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		this.passwordAuth = new SupabasePasswordAuth(
			this.admin,
			this.anon,
			(email, password) => this.signIn(email, password),
			config.enableSelfSignup ?? false,
			(user) => this.hydrate(user)
		);
		this.sessionRefresh = new SupabaseSessionRefresh(this.anon, this.admin, this.logger);
		this.oauth = new SupabaseOAuthAuth(
			this.anon,
			(user) => this.hydrate(user),
			config.oauthProviders ?? [],
			this.sessionRefresh
		);
		this.emailLink = new SupabaseEmailLinkAuth(
			this.anon,
			(user) => this.hydrate(user),
			config.allowEmailLinkSignup ?? true
		);
	}

	static fromEnv(env: Record<string, string | undefined>, logger?: ILogger): SupabaseAuthProvider {
		const supabaseUrl = env.SUPABASE_URL;
		const anonKey = env.SUPABASE_ANON_KEY;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		const oauthProviders = (env.SUPABASE_OAUTH_PROVIDERS ?? '')
			.split(',')
			.map((p) => p.trim().toLowerCase())
			.filter((p) => p.length > 0);
		const tokenVerification = env.SUPABASE_TOKEN_VERIFICATION === 'strict' ? 'strict' : 'hybrid';
		const revalidateMs = parsePositiveInt(env.SUPABASE_REVALIDATE_MS);
		return new SupabaseAuthProvider({
			supabaseUrl,
			anonKey,
			serviceRoleKey,
			enableSelfSignup: env.SUPABASE_ENABLE_SELF_SIGNUP === 'true',
			oauthProviders,
			allowEmailLinkSignup: env.SUPABASE_ALLOW_EMAIL_LINK_SIGNUP !== 'false',
			tokenVerification,
			...(revalidateMs !== undefined ? { revalidateMs } : {}),
			...(logger ? { logger } : {})
		});
	}

	/**
	 * Verify a session JWT and return the user, or null if invalid/disabled.
	 * Runs on every authenticated request, so the fast path avoids a network
	 * round-trip.
	 *
	 * `'hybrid'` (default): `getClaims(token)` verifies the JWT locally with
	 * asymmetric signing keys (the modern Supabase default — the SDK checks
	 * against the cached JWKS via Web Crypto, no GoTrue call), and falls back
	 * to a network verify for legacy symmetric HS256 projects. Either way, a
	 * local check can't see a server-side sign-out or `disabled` flip that
	 * happened after the token was issued — the claims are a snapshot — so we
	 * also re-check against GoTrue via `getUser`, at most once per
	 * `revalidateMs` per session, bounding revocation latency to that window
	 * while skipping the network call on most requests.
	 *
	 * `'strict'`: `getUser` on every request. Instant revocation, one round
	 * trip per request.
	 */
	async verifyToken(token: string): Promise<AuthUser | null> {
		if (!token) return null;

		if (this.tokenVerification === 'strict') {
			return this.verifyViaGetUser(token);
		}

		const claims = await this.getClaimsOrNull(token);
		if (!claims) return null;
		if ((claims.user_metadata as { disabled?: boolean } | undefined)?.disabled === true) {
			return null;
		}

		const sessionId = typeof claims.session_id === 'string' ? claims.session_id : claims.sub;
		if (this.shouldRevalidate(sessionId)) {
			const fresh = await this.verifyViaGetUser(token);
			if (!fresh) {
				this.lastRevalidatedAt.delete(sessionId);
				return null;
			}
			this.markRevalidated(sessionId);
			return fresh;
		}

		return {
			id: claims.sub,
			email: typeof claims.email === 'string' ? claims.email : undefined,
			disabled: false,
			metadata: claims.user_metadata
		};
	}

	/** Full network verify against GoTrue. Also the `'strict'`-mode path. */
	private async verifyViaGetUser(token: string): Promise<AuthUser | null> {
		const { data, error } = await this.anon.auth.getUser(token);
		if (error || !data.user) return null;
		if (data.user.user_metadata?.disabled === true) return null;
		return this.hydrate(data.user);
	}

	/** Local JWT verification. Returns the claims, or null if invalid/expired. */
	private async getClaimsOrNull(token: string) {
		try {
			const { data, error } = await this.anon.auth.getClaims(token);
			if (error || !data) return null;
			return data.claims;
		} catch {
			return null;
		}
	}

	private shouldRevalidate(sessionId: string): boolean {
		const last = this.lastRevalidatedAt.get(sessionId);
		return last === undefined || Date.now() - last >= this.revalidateMs;
	}

	private markRevalidated(sessionId: string): void {
		const now = Date.now();
		this.lastRevalidatedAt.set(sessionId, now);
		// Lazy sweep so a churn of distinct sessions can't grow the map without
		// bound. Anything older than two windows is definitely stale (it would
		// revalidate on next use anyway). Cheap: only runs when the map is large.
		if (this.lastRevalidatedAt.size > 10_000) {
			const cutoff = now - this.revalidateMs * 2;
			for (const [id, ts] of this.lastRevalidatedAt) {
				if (ts < cutoff) this.lastRevalidatedAt.delete(id);
			}
		}
	}

	async getUser(id: string): Promise<AuthUser | null> {
		const { data, error } = await this.admin.auth.admin.getUserById(id);
		if (error || !data.user) return null;
		return this.hydrate(data.user);
	}

	async listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null> {
		// GoTrue paginates by page number, not offset — translate our cursor.
		const perPage = opts?.limit ?? 50;
		const page = opts?.cursor ? parseInt(opts.cursor, 10) : 1;
		const { data, error } = await this.admin.auth.admin.listUsers({
			page: Number.isFinite(page) && page >= 1 ? page : 1,
			perPage
		});
		if (error) throw error;

		const users = data.users;
		const hydrated = users.map((u) => this.hydrate(u));
		const nextCursor = users.length >= perPage ? String(page + 1) : undefined;
		return { items: hydrated, nextCursor };
	}

	async createUser(email: string): Promise<AuthUser> {
		// No password — the user signs in via magic link or OAuth.
		const { data, error } = await this.admin.auth.admin.createUser({
			email,
			email_confirm: true
		});
		if (error) throw error;
		if (!data.user) throw new Error('createUser returned no user');
		return this.hydrate(data.user);
	}

	async deleteUser(id: string): Promise<UserManagementResult> {
		// Identity-only: the sole-instance_admin invariant lives on
		// IPlatformPermissionStore, which callers must consult before this.
		const { error } = await this.admin.auth.admin.deleteUser(id);
		if (error) {
			// GoTrue's 404 shows up as either a status code or a message string.
			const e = error as unknown as { status?: number; message?: string };
			if (e.status === 404 || /not.?found/i.test(e.message ?? '')) return 'not_found';
			throw error;
		}
		return 'ok';
	}

	async disableUser(id: string): Promise<UserManagementResult> {
		const { data: existing, error: fetchError } = await this.admin.auth.admin.getUserById(id);
		if (fetchError || !existing.user) return 'not_found';
		// GoTrue's user_metadata update merges shallowly — preserve existing
		// fields by spreading them in.
		const mergedMetadata = {
			...(existing.user.user_metadata ?? {}),
			disabled: true
		};
		const { error } = await this.admin.auth.admin.updateUserById(id, {
			user_metadata: mergedMetadata
		});
		if (error) {
			const e = error as unknown as { status?: number; message?: string };
			if (e.status === 404 || /not.?found/i.test(e.message ?? '')) return 'not_found';
			throw error;
		}
		return 'ok';
	}

	async touchLastLogin(id: string): Promise<void> {
		// Debounced in a single UPDATE: the WHERE clause skips the write when the
		// stamp is recent, so a login storm from one user costs one no-op
		// round-trip instead of a select + conditional update.
		const cutoff = new Date(Date.now() - 60_000).toISOString();
		// Must use `this.db`, not `this.admin` — `user_profiles` lives in `selva`,
		// and an unpinned client resolves against `public`, where the table
		// doesn't exist. That relation-not-found error previously went to an
		// unchecked await and the stamp silently never landed.
		const { error } = await this.db
			.from('user_profiles')
			.update({ last_login_at: new Date().toISOString() })
			.eq('user_id', id)
			.or(`last_login_at.is.null,last_login_at.lt.${cutoff}`);
		// Never throws — a failed stamp must not block auth — but it's logged
		// now instead of swallowed, so a regression here doesn't stay invisible.
		if (error) {
			this.logger.warn('touchLastLogin failed', {
				userId: id,
				code: error.code,
				message: error.message
			});
		}
	}

	// ============================================================================
	// Internals
	// ============================================================================
	/** Kept on the provider class so it can call `hydrate` without plumbing it through. */
	private async signIn(
		email: string,
		password: string
	): Promise<{ user: AuthUser; sessionToken: string } | null> {
		const { data, error } = await this.anon.auth.signInWithPassword({ email, password });
		if (error || !data.user || !data.session) return null;
		if (data.user.user_metadata?.disabled === true) return null;
		return { user: this.hydrate(data.user), sessionToken: data.session.access_token };
	}

	/** Map a GoTrue `User` to our identity-only `AuthUser`. */
	private hydrate(user: User): AuthUser {
		return {
			id: user.id,
			email: user.email ?? undefined,
			createdAt: user.created_at ?? undefined,
			lastLoginAt: user.last_sign_in_at ?? undefined,
			disabled: user.user_metadata?.disabled === true,
			metadata: user.user_metadata
		};
	}

	/** Lets other code (storage provider, per-request client factories) build user-scoped clients without a second config read. */
	getAnonClientConfig(): { supabaseUrl: string; anonKey: string } {
		return { supabaseUrl: this.supabaseUrl, anonKey: this.anonKey };
	}
}

class SupabasePasswordAuth implements IPasswordAuth {
	constructor(
		private readonly admin: SupabaseClient,
		private readonly anon: SupabaseClient,
		private readonly signIn: (
			email: string,
			password: string
		) => Promise<{ user: AuthUser; sessionToken: string } | null>,
		private readonly enableSelfSignup: boolean,
		private readonly hydrate: (user: User) => AuthUser
	) {}

	async verifyLogin(email: string, password: string): Promise<LoginResult> {
		const result = await this.signIn(email, password);
		if (!result) return { kind: 'failed', reason: 'invalid_credentials' };
		return { kind: 'success', user: result.user, sessionToken: result.sessionToken };
	}

	async createUserWithPassword(email: string, password: string): Promise<AuthUser> {
		const { data, error } = await this.admin.auth.admin.createUser({
			email,
			password,
			email_confirm: true
		});
		if (error) throw error;
		if (!data.user) throw new Error('createUserWithPassword returned no user');
		return this.hydrate(data.user);
	}

	async registerUser(email: string, password: string): Promise<AuthUser | null> {
		if (!this.enableSelfSignup) return null;
		const { data, error } = await this.anon.auth.signUp({ email, password });
		if (error || !data.user) return null;
		return this.hydrate(data.user);
	}
}

/**
 * Supabase-backed `IOAuthAuth`. Thin wrapper over GoTrue's `signInWithOAuth`
 * / `exchangeCodeForSession` — mapping failures to null vs throw is the only logic.
 */
class SupabaseOAuthAuth implements IOAuthAuth {
	constructor(
		private readonly anon: SupabaseClient,
		private readonly hydrate: (user: User) => AuthUser,
		private readonly providers: readonly string[],
		private readonly sessionRefresh: ISessionRefresh
	) {}

	listProviders(): readonly string[] {
		return this.providers;
	}

	async getOAuthAuthorizationUrl(
		provider: 'google' | 'github' | 'azure' | 'gitlab',
		redirectTo: string
	): Promise<string> {
		const { data, error } = await this.anon.auth.signInWithOAuth({
			provider,
			options: { redirectTo, skipBrowserRedirect: true }
		});
		if (error || !data.url) throw error ?? new Error('signInWithOAuth returned no URL');
		return data.url;
	}

	async exchangeOAuthCode(code: string): Promise<{
		user: AuthUser;
		sessionToken: string;
		refreshToken: string;
	} | null> {
		const { data, error } = await this.anon.auth.exchangeCodeForSession(code);
		if (error || !data.user || !data.session) return null;
		if (data.user.user_metadata?.disabled === true) return null;
		return {
			user: this.hydrate(data.user),
			sessionToken: data.session.access_token,
			refreshToken: data.session.refresh_token
		};
	}

	/** @deprecated Delegates to `IAuthProvider.sessionRefresh`. Removed next minor. */
	async refreshSession(refreshToken: string): Promise<{
		sessionToken: string;
		refreshToken: string;
	} | null> {
		return this.sessionRefresh.refreshSession(refreshToken);
	}
}

/**
 * Supabase-backed `ISessionRefresh`. `refreshSession` uses the anon client —
 * a refresh token authenticates itself. `revokeSession` uses the service-role
 * client — revoking someone else's session is privileged.
 */
class SupabaseSessionRefresh implements ISessionRefresh {
	constructor(
		private readonly anon: SupabaseClient,
		private readonly admin: SupabaseClient,
		private readonly logger: ILogger
	) {}

	async refreshSession(refreshToken: string): Promise<{
		sessionToken: string;
		refreshToken: string;
	} | null> {
		const { data, error } = await this.anon.auth.refreshSession({ refresh_token: refreshToken });
		if (error || !data.session) return null;
		// Refresh runs after verifyToken has already failed, so it's the last gate
		// on an expired-access-token request. Without this check, a disabled user
		// could mint fresh access tokens forever — verifyToken's revalidateMs
		// bound never gets a chance to apply. GoTrue returns the user alongside
		// the session, so the check is free.
		if (data.user?.user_metadata?.disabled === true) return null;
		return {
			sessionToken: data.session.access_token,
			refreshToken: data.session.refresh_token
		};
	}

	async revokeSession(token: string): Promise<boolean> {
		// 'global': sign out every session for this user, not just the one this
		// JWT names. Logout on a shared machine shouldn't leave a sibling session
		// alive, and a token that reached us at all may already be leaked.
		const { error } = await this.admin.auth.admin.signOut(token, 'global');
		if (!error) return true;
		// A token GoTrue no longer recognizes (already signed out, expired,
		// malformed) is the desired end state, not a failure — report success so
		// the caller doesn't log noise on every double-logout.
		const e = error as unknown as { status?: number; message?: string };
		if (e.status === 401 || e.status === 403 || e.status === 404) return true;
		// Anything else (5xx, network, misconfigured service-role key) means the
		// session may still be live. Never throw — a failed revoke must not
		// block the user from logging out.
		this.logger.warn('revokeSession failed', { status: e.status, message: e.message });
		return false;
	}
}

/**
 * Supabase-backed `IEmailLinkAuth`. Wraps GoTrue's `signInWithOtp` (send)
 * and `verifyOtp` (verify on click).
 *
 * Supabase emails the user `{callbackUrl}?token_hash=…&type=…`. The `type`
 * param picks which OTP variant `verifyOtp` runs (signup vs returning-user
 * magic link vs invite acceptance), so we pass it through unchanged.
 */
class SupabaseEmailLinkAuth implements IEmailLinkAuth {
	constructor(
		private readonly anon: SupabaseClient,
		private readonly hydrate: (user: User) => AuthUser,
		private readonly allowSignup: boolean
	) {}

	async sendMagicLink(
		email: string,
		callbackUrl: string
	): Promise<
		{ ok: true } | { ok: false; reason: 'rate_limited' | 'signup_disabled' | 'invalid_email' }
	> {
		const { error } = await this.anon.auth.signInWithOtp({
			email,
			options: {
				emailRedirectTo: callbackUrl,
				shouldCreateUser: this.allowSignup
			}
		});
		if (!error) return { ok: true };

		// Anything we don't recognize, throw — the route returns 500 with a
		// stack trace instead of us swallowing a real bug as "rate limited".
		const status = (error as { status?: number }).status;
		const code = (error as { code?: string }).code;
		const message = error.message ?? '';
		if (status === 429 || /rate.?limit/i.test(message))
			return { ok: false, reason: 'rate_limited' };
		if (
			code === 'otp_disabled' ||
			code === 'signup_disabled' ||
			/signup.*disabled/i.test(message)
		) {
			return { ok: false, reason: 'signup_disabled' };
		}
		if (code === 'validation_failed' || /invalid.*email|email.*invalid/i.test(message)) {
			return { ok: false, reason: 'invalid_email' };
		}
		throw error;
	}

	async verifyMagicLink(rawCallbackUrl: string): Promise<{
		user: AuthUser;
		sessionToken: string;
		refreshToken?: string;
	} | null> {
		const params = parseCallbackParams(rawCallbackUrl);
		if (!params) return null;
		const { tokenHash, type } = params;

		const { data, error } = await this.anon.auth.verifyOtp({
			token_hash: tokenHash,
			type
		});
		if (error || !data.user || !data.session) return null;
		if (data.user.user_metadata?.disabled === true) return null;
		return {
			user: this.hydrate(data.user),
			sessionToken: data.session.access_token,
			refreshToken: data.session.refresh_token
		};
	}
}

/**
 * Pull `token_hash` + `type` from either a full callback URL or a bare
 * `token_hash=…&type=…` query string. Tolerant of both shapes so the route
 * layer can pass whichever form is convenient.
 *
 * Returns null when the inputs aren't recognizable — the caller treats null
 * as "send the user back to /login".
 */
function parseCallbackParams(
	raw: string
): { tokenHash: string; type: 'magiclink' | 'email' | 'signup' | 'invite' | 'recovery' } | null {
	let search: URLSearchParams;
	try {
		search = new URL(raw).searchParams;
	} catch {
		search = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
	}
	const tokenHash = search.get('token_hash');
	const type = search.get('type');
	if (!tokenHash) return null;
	const allowed = new Set(['magiclink', 'email', 'signup', 'invite', 'recovery']);
	if (!type || !allowed.has(type)) return null;
	return {
		tokenHash,
		type: type as 'magiclink' | 'email' | 'signup' | 'invite' | 'recovery'
	};
}
