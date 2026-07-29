import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NoopLogger, type ILogger } from '@selvajs/platform';
import { DEFAULT_SCHEMA, type SelvaSchemaClient } from '../data/client.js';
import type {
	IAuthProvider,
	IEmailLinkAuth,
	IOAuthAuth,
	IPasswordAuth,
	AuthUser,
	LoginResult,
	UserManagementResult,
	ListOptions,
	Page
} from '@selvajs/platform';

/**
 * Auth backed by Supabase Auth (GoTrue).
 *
 * Identity + session lifecycle are fully delegated:
 *  - `verifyLogin` wraps `auth.signInWithPassword` — returns the access_token
 *    straight from Supabase as the session token.
 *  - `verifyToken` calls `auth.getUser(token)` against an anon client scoped
 *    to that bearer; GoTrue validates the JWT for us.
 *  - User management uses `auth.admin.*` with the service-role client.
 *
 * Identity-only — platform permissions live on `IPlatformPermissionStore`
 * (`SupabasePlatformPermissionStore` reads `user_profiles.platform_permissions`)
 * and profile state on `IUserProfileStore`.
 */
export interface SupabaseAuthProviderConfig {
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
	/**
	 * Whether self-service signup is allowed via `passwordAuth.registerUser`.
	 * Default false — production deployments start with invite-only.
	 */
	enableSelfSignup?: boolean;
	/**
	 * OAuth providers enabled in the Supabase dashboard (lowercased:
	 * "google", "github", …). Surfaced via `oauth.listProviders()` so the
	 * driving layer doesn't read provider-specific env vars itself. Defaults
	 * to an empty list.
	 */
	oauthProviders?: readonly string[];
	/**
	 * Allow `emailLink.sendMagicLink` to create new users on first request.
	 * Default true — matches Supabase's `signInWithOtp` default and gives
	 * fresh installs a working signup path. Set false for invite-only
	 * deployments; `sendMagicLink` for an unknown email returns
	 * `{ ok: false, reason: 'signup_disabled' }`.
	 */
	allowEmailLinkSignup?: boolean;
	/**
	 * How `verifyToken` validates session JWTs (see the method for the full
	 * rationale):
	 *  - `'hybrid'` (default): verify the JWT LOCALLY via `getClaims()` on every
	 *    request (no network call when the project uses asymmetric signing keys —
	 *    the modern default), and additionally re-check against GoTrue at most
	 *    once per `revalidateMs` per session to catch server-side sign-outs and
	 *    `disabled` flips. Bounds revocation latency to `revalidateMs`.
	 *  - `'strict'`: call `getUser()` on every request (the pre-1b behavior).
	 *    Instant revocation, one network round-trip per request. For operators
	 *    who don't accept any revocation lag.
	 */
	tokenVerification?: 'hybrid' | 'strict';
	/**
	 * Recheck window for `'hybrid'` verification, in ms. A verified session is
	 * re-validated against GoTrue at most once per this interval. Default 60s.
	 */
	revalidateMs?: number;
	/**
	 * Sink for best-effort failures the provider swallows rather than throwing
	 * (currently `touchLastLogin`). Defaults to `NoopLogger` — pass one to make
	 * those failures visible. Only identifiers are ever logged, never payloads.
	 */
	logger?: ILogger;
}

/** Default hybrid recheck window — see `revalidateMs`. */
const DEFAULT_REVALIDATE_MS = 60_000;

/** Parse a positive integer env var, or undefined if unset/invalid. */
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

	private readonly admin: SupabaseClient;
	/**
	 * Service-role client pinned to the engine schema (`selva`). Engine tables
	 * live there, not in `public` — `this.admin` is deliberately left unpinned
	 * because it exists to drive `auth.admin.*` (GoTrue's own REST surface,
	 * which the PostgREST schema setting does not affect). Any table read or
	 * write from this provider MUST go through this client instead.
	 */
	private readonly db: SelvaSchemaClient;
	private readonly anon: SupabaseClient;
	private readonly anonKey: string;
	private readonly supabaseUrl: string;
	private readonly tokenVerification: 'hybrid' | 'strict';
	private readonly revalidateMs: number;
	private readonly logger: ILogger;

	/**
	 * Last time a given session was re-validated against GoTrue (epoch ms),
	 * keyed by the JWT `session_id`. Bounds the hybrid recheck to once per
	 * `revalidateMs` per session. Swept lazily (see `verifyToken`) so a burst of
	 * distinct sessions can't leak memory. Per-process; multi-instance drift is
	 * harmless (each instance rechecks on its own schedule).
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
		this.oauth = new SupabaseOAuthAuth(
			this.anon,
			(user) => this.hydrate(user),
			config.oauthProviders ?? []
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
		// Local JWT verification is the default (fast; requires asymmetric signing
		// keys to skip the network — the Supabase default since 2025). Set
		// SUPABASE_TOKEN_VERIFICATION=strict to force a getUser() per request.
		const tokenVerification = env.SUPABASE_TOKEN_VERIFICATION === 'strict' ? 'strict' : 'hybrid';
		const revalidateMs = parsePositiveInt(env.SUPABASE_REVALIDATE_MS);
		return new SupabaseAuthProvider({
			supabaseUrl,
			anonKey,
			serviceRoleKey,
			enableSelfSignup: env.SUPABASE_ENABLE_SELF_SIGNUP === 'true',
			oauthProviders,
			// Default true; set SUPABASE_ALLOW_EMAIL_LINK_SIGNUP=false to lock down
			// to invite-only and reject magic-link signups for new addresses.
			allowEmailLinkSignup: env.SUPABASE_ALLOW_EMAIL_LINK_SIGNUP !== 'false',
			tokenVerification,
			...(revalidateMs !== undefined ? { revalidateMs } : {}),
			...(logger ? { logger } : {})
		});
	}

	/**
	 * Verify a session JWT and return the user, or null if invalid/disabled.
	 * Runs on EVERY authenticated request, so the fast path avoids a network
	 * round-trip.
	 *
	 * `'hybrid'` (default):
	 *  1. `getClaims(token)` verifies the JWT. With asymmetric signing keys (the
	 *     modern Supabase default) this is LOCAL — the SDK verifies against the
	 *     cached JWKS via Web Crypto, no call to GoTrue. With a legacy symmetric
	 *     HS256 secret the SDK transparently falls back to a network verify, so
	 *     this is correct for both project types without us detecting the scheme
	 *     or hand-rolling JWKS handling (which the Supabase docs warn against —
	 *     it breaks under key rotation).
	 *  2. Local verification can't see a server-side sign-out or a `disabled`
	 *     flip that happened AFTER the token was issued (the claims are a
	 *     snapshot). So we additionally re-check against GoTrue via `getUser`,
	 *     but at most once per `revalidateMs` per session — bounding revocation
	 *     latency to that window while eliminating ~all per-request network
	 *     calls under steady load.
	 *
	 * `'strict'`: `getUser` on every request — instant revocation, one round
	 * trip per request. The pre-1b behavior, for operators who accept no lag.
	 */
	async verifyToken(token: string): Promise<AuthUser | null> {
		if (!token) return null;

		if (this.tokenVerification === 'strict') {
			return this.verifyViaGetUser(token);
		}

		// --- hybrid: local verify first ---
		const claims = await this.getClaimsOrNull(token);
		if (!claims) return null;
		// `disabled` as of token issue. A flip AFTER issue is caught by the
		// periodic recheck below.
		if ((claims.user_metadata as { disabled?: boolean } | undefined)?.disabled === true) {
			return null;
		}

		// Periodic recheck: catch sign-out / disabled since the token was issued.
		const sessionId = typeof claims.session_id === 'string' ? claims.session_id : claims.sub;
		if (this.shouldRevalidate(sessionId)) {
			const fresh = await this.verifyViaGetUser(token);
			// getUser rejected it (signed out, disabled, revoked) → deny now.
			if (!fresh) {
				this.lastRevalidatedAt.delete(sessionId);
				return null;
			}
			this.markRevalidated(sessionId);
			return fresh;
		}

		// Build the user from claims — no network call on this path.
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
		// GoTrue's admin.listUsers uses its own pagination (page/perPage).
		// Translate our cursor (offset) into page number.
		const perPage = opts?.limit ?? 50;
		const page = opts?.cursor ? parseInt(opts.cursor, 10) : 1;
		const { data, error } = await this.admin.auth.admin.listUsers({
			page: Number.isFinite(page) && page >= 1 ? page : 1,
			perPage
		});
		if (error) throw error;

		const users = data.users;
		const hydrated = users.map((u) => this.hydrate(u));
		// If the page was full, assume there may be more.
		const nextCursor = users.length >= perPage ? String(page + 1) : undefined;
		return { items: hydrated, nextCursor };
	}

	async createUser(email: string): Promise<AuthUser> {
		// Allowlist variant: create without a password. The user receives a
		// magic-link / OIDC handoff from the consuming app. Identity-only;
		// platform permissions are granted via IPlatformPermissionStore.
		const { data, error } = await this.admin.auth.admin.createUser({
			email,
			email_confirm: true
		});
		if (error) throw error;
		if (!data.user) throw new Error('createUser returned no user');
		return this.hydrate(data.user);
	}

	async deleteUser(id: string): Promise<UserManagementResult> {
		// Identity-only delete. The §2 sole-`instance_admin` invariant lives
		// on IPlatformPermissionStore; callers consult it before calling here.
		const { error } = await this.admin.auth.admin.deleteUser(id);
		if (error) {
			// 404-shaped errors from GoTrue surface as { status: 404 } or a
			// specific message. Normalize to 'not_found' rather than throwing.
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
		// 60-second debounce, done in a single UPDATE: the WHERE clause skips the
		// write when the stamp is recent, so a login storm from one user costs one
		// no-op round-trip instead of a select + conditional update. Matches the
		// local provider's debounce window.
		const cutoff = new Date(Date.now() - 60_000).toISOString();
		// `this.db`, not `this.admin` — `user_profiles` lives in the `selva`
		// schema. An unpinned client resolves it against `public`, where the
		// table does not exist, and PostgREST's relation-not-found error was
		// being swallowed by the unchecked await: the stamp never landed.
		const { error } = await this.db
			.from('user_profiles')
			.update({ last_login_at: new Date().toISOString() })
			.eq('user_id', id)
			.or(`last_login_at.is.null,last_login_at.lt.${cutoff}`);
		// Best-effort per the interface contract — a failed stamp MUST NOT block
		// auth, so this never throws. But it is no longer invisible: a schema or
		// permission regression here would otherwise stay silent forever.
		if (error) {
			this.logger.warn('touchLastLogin failed', {
				userId: id,
				code: error.code,
				message: error.message
			});
		}
	}

	// OAuth lives on `this.oauth` (typed `IOAuthAuth`); see `SupabaseOAuthAuth`
	// below. Mirrors the `passwordAuth` capability split.

	// ============================================================================
	// Internals
	// ============================================================================
	/**
	 * Sign in via GoTrue. Returns the access token string and the hydrated
	 * user. Called by `SupabasePasswordAuth.verifyLogin` — kept on the
	 * provider class so it has access to the hydrate helper without plumbing.
	 */
	private async signIn(
		email: string,
		password: string
	): Promise<{ user: AuthUser; sessionToken: string } | null> {
		const { data, error } = await this.anon.auth.signInWithPassword({ email, password });
		if (error || !data.user || !data.session) return null;
		if (data.user.user_metadata?.disabled === true) return null;
		return { user: this.hydrate(data.user), sessionToken: data.session.access_token };
	}

	/**
	 * Map a GoTrue `User` to our identity-only `AuthUser`. Platform permissions
	 * live on `IPlatformPermissionStore` and profile fields (displayName,
	 * starred, recentRuns) on `IUserProfileStore` — neither is in AuthUser.
	 */
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

	/**
	 * Expose the anon URL + key so other code (e.g. the same process's
	 * storage provider or per-request client factories) can build user-scoped
	 * clients without requiring a second config read.
	 */
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
		// Identity-only — platform permissions are granted separately via
		// IPlatformPermissionStore.set after creation.
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
 * Supabase-backed `IOAuthAuth`. Thin wrappers over GoTrue's `signInWithOAuth`
 * / `exchangeCodeForSession` / `refreshSession` — the failure-shape mapping
 * (return null vs throw) is the only logic.
 */
class SupabaseOAuthAuth implements IOAuthAuth {
	constructor(
		private readonly anon: SupabaseClient,
		private readonly hydrate: (user: User) => AuthUser,
		private readonly providers: readonly string[]
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

	async refreshSession(refreshToken: string): Promise<{
		sessionToken: string;
		refreshToken: string;
	} | null> {
		const { data, error } = await this.anon.auth.refreshSession({ refresh_token: refreshToken });
		if (error || !data.session) return null;
		// Refresh runs AFTER verifyToken has already failed, so it is the last
		// gate on an expired-access-token request. Without this check a disabled
		// user mints fresh access tokens indefinitely — `verifyToken`'s
		// `revalidateMs` bound never applies, because that path was skipped.
		// GoTrue returns the user alongside the session, so this costs nothing.
		if (data.user?.user_metadata?.disabled === true) return null;
		return {
			sessionToken: data.session.access_token,
			refreshToken: data.session.refresh_token
		};
	}
}

/**
 * Supabase-backed `IEmailLinkAuth`. Wraps GoTrue's `signInWithOtp` (send the
 * link) and `verifyOtp` with `type: 'magiclink' | 'email' | 'signup'`
 * (verify on click).
 *
 * Token shape: Supabase emails the user `{callbackUrl}?token_hash=…&type=…`.
 * `verifyMagicLink` accepts either the full URL or just the raw `token_hash`
 * — adapters MAY support either to give the route layer flexibility. The
 * `type` query param decides which OTP variant `verifyOtp` runs (signup vs
 * magic-link returning user vs invite acceptance), so we pass it through.
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

		// Map GoTrue's classified errors to our coarse reasons. Anything we
		// don't recognize we throw — the route returns 500 and we get a stack
		// trace, instead of swallowing a real bug as "rate limited".
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
		// Full URL path
		search = new URL(raw).searchParams;
	} catch {
		// Query-string-only path — treat as bare params.
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
