import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
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
 * Platform-scope permissions live in `public.user_profiles.platform_permissions`
 * (created by the `handle_new_auth_user` trigger on signup). We read them
 * server-side and merge into `AuthUser.platformPermissions` on every `getUser`
 * / `verifyToken` / `listUsers`. Profile state (displayName, starred, recent runs)
 * is NOT in the AuthUser — that's `SupabaseUserProfileProvider`'s job (§1e).
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
}

export class SupabaseAuthProvider implements IAuthProvider {
	readonly name = 'Supabase Auth';
	readonly passwordAuth: IPasswordAuth;

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
			() => this.hydrate.bind(this)
		);
	}

	static fromEnv(env: Record<string, string | undefined>): SupabaseAuthProvider {
		const supabaseUrl = env.SUPABASE_URL;
		const anonKey = env.SUPABASE_ANON_KEY;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		return new SupabaseAuthProvider({
			supabaseUrl,
			anonKey,
			serviceRoleKey,
			enableSelfSignup: env.SUPABASE_ENABLE_SELF_SIGNUP === 'true'
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
		const hydrated = await Promise.all(users.map((u) => this.hydrate(u)));
		// If the page was full, assume there may be more.
		const nextCursor = users.length >= perPage ? String(page + 1) : undefined;
		return { items: hydrated, nextCursor };
	}

	async createUser(email: string, platformPermissions: PlatformPermission[]): Promise<AuthUser> {
		// Allowlist variant: create without a password. The user receives a
		// magic-link / OIDC handoff from the consuming app.
		const { data, error } = await this.admin.auth.admin.createUser({
			email,
			email_confirm: true
		});
		if (error) throw error;
		if (!data.user) throw new Error('createUser returned no user');

		if (platformPermissions.length > 0) {
			await this.applyPlatformPermissions(data.user.id, platformPermissions);
		}
		return this.hydrate(data.user);
	}

	async updateUserPlatformPermissions(
		id: string,
		platformPermissions: PlatformPermission[]
	): Promise<UserManagementResult> {
		const { data: existing, error: fetchError } = await this.admin.auth.admin.getUserById(id);
		if (fetchError || !existing.user) return 'not_found';
		await this.applyPlatformPermissions(id, platformPermissions);
		return 'ok';
	}

	async deleteUser(id: string): Promise<UserManagementResult> {
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

	async touchLastLogin(id: string): Promise<void> {
		// 60-second debounce. Matches the local provider and GoTrue's own
		// audit cadence.
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

	// ── Internals ─────────────────────────────────────────────────────────────

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
		const user = await this.hydrate(data.user);
		return { user, sessionToken: data.session.access_token };
	}

	/**
	 * Merge a GoTrue `User` with the platform permissions from `user_profiles`
	 * into our platform-contract `AuthUser`. Profile fields (displayName,
	 * starred, recentRuns) are intentionally omitted — §1e split.
	 */
	private async hydrate(user: User): Promise<AuthUser> {
		// One service-role read per hydrate. Cheap; would cache per-request if
		// needed. `maybeSingle` returns null for users whose trigger hasn't
		// fired yet (race window during signup).
		const { data: profile } = await this.admin
			.from('user_profiles')
			.select('platform_permissions')
			.eq('user_id', user.id)
			.maybeSingle();

		const rawPerms = (profile?.platform_permissions ?? []) as string[];
		const platformPermissions = rawPerms.filter(
			(p): p is PlatformPermission => p === 'instance_admin'
		);

		return {
			id: user.id,
			email: user.email ?? undefined,
			platformPermissions,
			createdAt: user.created_at ?? undefined,
			lastLoginAt: user.last_sign_in_at ?? undefined,
			disabled: user.user_metadata?.disabled === true,
			metadata: user.user_metadata
		};
	}

	private async applyPlatformPermissions(
		id: string,
		platformPermissions: PlatformPermission[]
	): Promise<void> {
		const { error } = await this.admin
			.from('user_profiles')
			.update({ platform_permissions: platformPermissions })
			.eq('user_id', id);
		if (error) throw error;
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
		private readonly hydrateFactory: () => (user: User) => Promise<AuthUser>
	) {}

	async verifyLogin(email: string, password: string): Promise<LoginResult> {
		const result = await this.signIn(email, password);
		if (!result) return { kind: 'failed', reason: 'invalid_credentials' };
		return { kind: 'success', user: result.user, sessionToken: result.sessionToken };
	}

	async createUserWithPassword(
		email: string,
		password: string,
		platformPermissions: PlatformPermission[]
	): Promise<AuthUser> {
		const { data, error } = await this.admin.auth.admin.createUser({
			email,
			password,
			email_confirm: true
		});
		if (error) throw error;
		if (!data.user) throw new Error('createUserWithPassword returned no user');

		if (platformPermissions.length > 0) {
			const { error: upError } = await this.admin
				.from('user_profiles')
				.update({ platform_permissions: platformPermissions })
				.eq('user_id', data.user.id);
			if (upError) throw upError;
		}
		return this.hydrateFactory()(data.user);
	}

	async registerUser(email: string, password: string): Promise<AuthUser | null> {
		if (!this.enableSelfSignup) return null;
		const { data, error } = await this.anon.auth.signUp({ email, password });
		if (error || !data.user) return null;
		return this.hydrateFactory()(data.user);
	}
}
