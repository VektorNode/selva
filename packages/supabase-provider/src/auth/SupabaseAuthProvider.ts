import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
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
}

export class SupabaseAuthProvider implements IAuthProvider {
	readonly name = 'Supabase Auth';
	readonly passwordAuth: IPasswordAuth;
	readonly oauth: IOAuthAuth;
	readonly emailLink: IEmailLinkAuth;

	private readonly admin: SupabaseClient;
	private readonly anon: SupabaseClient;
	private readonly anonKey: string;
	private readonly supabaseUrl: string;

	constructor(config: SupabaseAuthProviderConfig) {
		this.supabaseUrl = config.supabaseUrl;
		this.anonKey = config.anonKey;
		this.admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
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

	static fromEnv(env: Record<string, string | undefined>): SupabaseAuthProvider {
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
		return new SupabaseAuthProvider({
			supabaseUrl,
			anonKey,
			serviceRoleKey,
			enableSelfSignup: env.SUPABASE_ENABLE_SELF_SIGNUP === 'true',
			oauthProviders,
			// Default true; set SUPABASE_ALLOW_EMAIL_LINK_SIGNUP=false to lock down
			// to invite-only and reject magic-link signups for new addresses.
			allowEmailLinkSignup: env.SUPABASE_ALLOW_EMAIL_LINK_SIGNUP !== 'false'
		});
	}

	async verifyToken(token: string): Promise<AuthUser | null> {
		if (!token) return null;
		// Per-request anon client with the JWT attached. `getUser(token)` also
		// works, but routing through a scoped client keeps future sub-calls
		// (profile fetch, etc.) RLS-aware if we ever move them here.
		const { data, error } = await this.anon.auth.getUser(token);
		if (error || !data.user) return null;
		if (data.user.user_metadata?.disabled === true) return null;
		return this.hydrate(data.user);
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
		// 60-second debounce. Matches the local provider.
		const { data, error } = await this.admin
			.from('user_profiles')
			.select('last_login_at')
			.eq('user_id', id)
			.maybeSingle();
		if (error) return;

		if (data?.last_login_at) {
			const prev = Date.parse(data.last_login_at);
			if (Number.isFinite(prev) && Date.now() - prev < 60_000) return;
		}
		await this.admin
			.from('user_profiles')
			.update({ last_login_at: new Date().toISOString() })
			.eq('user_id', id);
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
