import type { AuthUser, LoginResult, UserManagementResult } from './types.js';
import type { ListOptions, Page } from '../pagination.js';

/**
 * Optional password-based authentication surface. Implemented by providers
 * that own credentials (Local, Supabase Auth). OIDC-only providers leave
 * `IAuthProvider.passwordAuth` undefined.
 */
export interface IPasswordAuth {
	/**
	 * Verify credentials. Discriminated union — callers MUST `switch (result.kind)`,
	 * never treat truthiness as authenticated.
	 */
	verifyLogin(email: string, password: string): Promise<LoginResult>;

	/**
	 * Admin-initiated user creation. Pure identity — callers grant platform
	 * permissions separately via `IPlatformPermissionStore.set`.
	 */
	createUserWithPassword(email: string, password: string): Promise<AuthUser>;

	/** Self-service registration. Return null when self-registration is disabled. */
	registerUser?(email: string, password: string): Promise<AuthUser | null>;
}

/**
 * Optional OAuth surface. Implemented by providers that broker OAuth flows
 * (Supabase Auth, future Eterna/Auth0/etc.). Local credential-only providers
 * leave `IAuthProvider.oauth` undefined.
 *
 * Lifecycle is the standard authorization-code flow:
 *
 *   1. Browser hits `/auth/{provider}/start?provider=google` → server calls
 *      `getOAuthAuthorizationUrl` and 303s to the result.
 *   2. IdP redirects back to `/auth/{provider}/callback?code=...` →
 *      server calls `exchangeOAuthCode` to mint the session pair.
 *   3. When the access token expires, the session-refresh middleware in
 *      `hooks.server.ts` calls `refreshSession` with the stored refresh
 *      token to swap for a fresh pair without bouncing the user.
 *
 * Each method returns `null` (rather than throwing) on irrecoverable
 * credential failures — the route layer translates `null` into the right
 * HTTP shape (401 for refresh, login redirect for callback).
 */
export interface IOAuthAuth {
	/**
	 * The OAuth providers this adapter is configured to broker. Returned as
	 * lowercased identifiers ("google", "github", …) — the adapter reads its
	 * own configuration source (env var, dashboard, hard-coded list) and
	 * decides what's available. Empty array when none are wired.
	 *
	 * Driving adapters (HTTP routes, UI) call this instead of reading
	 * provider-specific env vars directly — keeps the provider name out of
	 * `selva`.
	 */
	listProviders(): readonly string[];

	/**
	 * Build the IdP authorization URL the browser should be redirected to.
	 * `redirectTo` is the full callback URL — must be the route that handles
	 * the `?code=...` exchange. Provider-name validation is the caller's job;
	 * passing an unconfigured provider may surface as an upstream error.
	 */
	getOAuthAuthorizationUrl(
		provider: 'google' | 'github' | 'azure' | 'gitlab',
		redirectTo: string
	): Promise<string>;

	/**
	 * Exchange an authorization code for a session. Returns the resolved
	 * identity and an access/refresh token pair. `null` when the code is
	 * invalid, expired, or already redeemed — callers MUST treat null as
	 * "send the user back to /login".
	 */
	exchangeOAuthCode(code: string): Promise<{
		user: AuthUser;
		sessionToken: string;
		refreshToken: string;
	} | null>;

	/**
	 * Swap a refresh token for a fresh access/refresh pair. Returns null on
	 * irrecoverable failure (revoked, expired, signed by a different secret);
	 * the session-refresh middleware treats null as "force re-login" by
	 * clearing the refresh cookie.
	 */
	refreshSession(refreshToken: string): Promise<{
		sessionToken: string;
		refreshToken: string;
	} | null>;
}

/**
 * Optional passwordless email surface — "type your email, click the link in
 * your inbox, you're in." Implemented by providers that broker email delivery
 * + token verification (Supabase Auth, future Eterna ID, …). Adapters that
 * can't send mail or don't model this flow leave `IAuthProvider.emailLink`
 * undefined.
 *
 * Lifecycle is two phases mirroring OAuth's start/callback split:
 *
 *   1. User submits an email → server calls `sendMagicLink(email,
 *      callbackUrl)`. The adapter delivers a link to that callback URL with
 *      whatever verification token shape it uses (Supabase: `?token_hash=…
 *      &type=magiclink`).
 *   2. User clicks the link, browser hits the callback route → server calls
 *      `verifyMagicLink(rawTokenFromUrl)` to mint a session.
 *
 * The driving adapter never inspects the token itself — it forwards the raw
 * URL string. Adapter-specific token shapes stay inside the adapter.
 */
export interface IEmailLinkAuth {
	/**
	 * Send a magic-link email. `callbackUrl` is the absolute URL the
	 * adapter should embed in the link — must point at the route that
	 * handles `verifyMagicLink`.
	 *
	 * Returns `{ ok: true }` on success. On adapter-classified failures
	 * (rate limit, signup disabled, invalid email) returns
	 * `{ ok: false, reason }` so the route can render a user-friendly
	 * message without exposing provider internals. Network/unknown errors
	 * still throw.
	 */
	sendMagicLink(
		email: string,
		callbackUrl: string
	): Promise<
		{ ok: true } | { ok: false; reason: 'rate_limited' | 'signup_disabled' | 'invalid_email' }
	>;

	/**
	 * Verify the token the IdP sent the user. `rawCallbackUrl` is the full
	 * URL the user landed on (or an opaque adapter-specific token string —
	 * adapters document which); the adapter pulls whatever fields it needs.
	 *
	 * Returns `null` for invalid/expired/already-redeemed tokens — callers
	 * MUST treat null as "send the user back to /login". `refreshToken` is
	 * present only for adapters that issue refresh tokens for email-link
	 * sessions (Supabase does); omit otherwise.
	 */
	verifyMagicLink(rawCallbackUrl: string): Promise<{
		user: AuthUser;
		sessionToken: string;
		refreshToken?: string;
	} | null>;
}

/**
 * Optional forward-proxy authentication surface. Implemented by providers
 * that derive identity from signals injected by a trusted upstream reverse
 * proxy (HTTP headers, mTLS, etc.) — e.g. Caddy `forward_auth`,
 * oauth2-proxy, Authelia, Pomerium, Traefik forward-auth.
 *
 * ⚠ TRUST BOUNDARY — READ BEFORE IMPLEMENTING ⚠
 *
 * The signals this surface consumes are NOT verified cryptographically by
 * Selva. They are trusted because the deployment runs the app behind a
 * proxy that:
 *
 *   1. Authenticates the user against an upstream IdP, AND
 *   2. STRIPS any client-supplied copies of the trusted headers from
 *      inbound requests before adding its own, AND
 *   3. Is the ONLY network path that can reach the app process (bind to
 *      127.0.0.1, firewall the app port, or a private socket).
 *
 * If any condition fails, an attacker can spoof the headers and become
 * anyone. **Each implementer of this interface MUST ship a README that
 * states, loudly, the exact proxy configuration required.** The platform
 * layer cannot verify this — it is the provider's contract with its
 * operator.
 *
 * Lifecycle: `identifyFromHeaders` is called from `hooks.server.ts` on
 * every authed request whose session cookie is missing or invalid. It MUST
 * be cheap — a header read plus at most one indexed lookup. No network
 * calls, no synchronous disk scans of unbounded size.
 */
export interface IProxyAuth {
	/**
	 * Identify the caller from trusted upstream-proxy signals on the
	 * incoming request. Return `null` for "not identified" (header missing,
	 * UPN not allowlisted, account disabled). MUST NOT throw for absent
	 * headers — those are the normal anonymous case.
	 *
	 * On first identification of a previously-allowlisted user, the
	 * implementation MAY materialize stored fields (display name, email)
	 * from the same headers. Auto-creating arbitrary users from headers
	 * is forbidden: the allowlist IS the security boundary.
	 */
	identifyFromHeaders(headers: Headers): Promise<AuthUser | null>;
}

/**
 * Authentication provider — identity verification only. Profile state lives
 * in `IUserProfileStore`, platform permissions in `IPlatformPermissionStore`,
 * password ops in optional `passwordAuth`, OAuth in optional `oauth`.
 *
 * Methods here do NOT take a `RequestContext` — the provider produces the
 * identity used to *build* the context.
 */
export interface IAuthProvider {
	/** Display name shown in admin UI (e.g. "Local", "Microsoft Entra ID"). */
	readonly name: string;

	/** Present for credential-owning providers; undefined for OIDC-only. */
	readonly passwordAuth?: IPasswordAuth;

	/** Present for providers that broker OAuth flows; undefined otherwise. */
	readonly oauth?: IOAuthAuth;

	/**
	 * Present for providers that send sign-in links over email (Supabase Auth,
	 * future Eterna ID). Undefined otherwise.
	 */
	readonly emailLink?: IEmailLinkAuth;

	/**
	 * Present for providers that derive identity from a trusted upstream
	 * proxy (forward-auth headers, mTLS, etc.). Undefined for credential
	 * or OIDC-broker providers. See `IProxyAuth` for the trust contract.
	 *
	 * When set, the platform treats sign-out as the proxy/IdP's job and
	 * does not render a logout button — Selva has no session to destroy.
	 */
	readonly proxyAuth?: IProxyAuth;

	/**
	 * Verify a token (session cookie, JWT, ID token, etc.). Returns the user
	 * or null when invalid/expired.
	 */
	verifyToken(token: string): Promise<AuthUser | null>;

	getUser(id: string): Promise<AuthUser | null>;

	/** Returns null if the provider does not support user management. */
	listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null>;

	/**
	 * Optional: allowlist a user without a password (OAuth providers). Pure
	 * identity — callers grant permissions via `IPlatformPermissionStore.set`.
	 */
	createUser?(email: string): Promise<AuthUser>;

	/**
	 * Delete a user identity. The sole-`instance_admin` invariant is NOT
	 * enforced here — callers MUST consult
	 * `IPlatformPermissionStore.countInstanceAdminsExcluding(id)` first and
	 * surface `'last_admin'` themselves.
	 */
	deleteUser(id: string): Promise<UserManagementResult>;

	/**
	 * Disable a user. Sessions become invalid; identity is preserved (preferred
	 * over deletion). Same invariant rules as `deleteUser`.
	 */
	disableUser(id: string): Promise<UserManagementResult>;

	/**
	 * Stamp `lastLoginAt`. Best-effort — failure MUST NOT block auth.
	 * Adapters MAY debounce (e.g. skip if existing timestamp < 60s old).
	 */
	touchLastLogin?(id: string): Promise<void>;
}
