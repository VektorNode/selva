import type { AuthUser, LoginResult, UserManagementResult } from './types.js';
import type { ListOptions, Page } from '../pagination.js';

/**
 * Optional password-based authentication surface. Implemented by providers
 * that own credentials (Local, Supabase Auth). OIDC-only providers leave
 * `IAuthProvider.passwordAuth` undefined.
 */
export interface IPasswordAuth {
	/**
	 * Verify credentials. Returns a discriminated union — callers must
	 * `switch (result.kind)`, never treat truthiness as authenticated.
	 */
	verifyLogin(email: string, password: string): Promise<LoginResult>;

	/**
	 * Admin-initiated user creation. Grant platform permissions separately
	 * via `IPlatformPermissionStore.set`.
	 */
	createUserWithPassword(email: string, password: string): Promise<AuthUser>;

	/** Self-service registration. Return null when self-registration is disabled. */
	registerUser?(email: string, password: string): Promise<AuthUser | null>;
}

/**
 * Optional OAuth surface. Implemented by providers that broker OAuth flows
 * (Supabase Auth, future Eterna/Auth0/etc.); local credential-only providers
 * leave `IAuthProvider.oauth` undefined.
 *
 * Standard authorization-code flow:
 *
 *   1. Browser hits `/auth/{provider}/start?provider=google` → server calls
 *      `getOAuthAuthorizationUrl` and 303s to the result.
 *   2. IdP redirects back to `/auth/{provider}/callback?code=...` → server
 *      calls `exchangeOAuthCode` to mint the session pair.
 *   3. When the access token expires, session-refresh middleware in
 *      `hooks.server.ts` calls `refreshSession` to swap in a fresh pair
 *      without bouncing the user.
 *
 * Each method returns `null` rather than throwing on irrecoverable
 * credential failures, so the route layer can pick the right HTTP shape
 * (401 for refresh, login redirect for callback).
 */
export interface IOAuthAuth {
	/**
	 * OAuth providers this adapter is configured to broker, as lowercased
	 * identifiers ("google", "github", …). Empty array when none are wired.
	 *
	 * Route/UI code calls this instead of reading provider-specific env vars
	 * directly, keeping provider config out of `selva`.
	 */
	listProviders(): readonly string[];

	/**
	 * Build the IdP authorization URL to redirect the browser to. `redirectTo`
	 * must be the route that handles the `?code=...` exchange. Provider-name
	 * validation is the caller's job — an unconfigured provider may surface
	 * as an upstream error.
	 */
	getOAuthAuthorizationUrl(
		provider: 'google' | 'github' | 'azure' | 'gitlab',
		redirectTo: string
	): Promise<string>;

	/**
	 * Exchange an authorization code for a session: the resolved identity plus
	 * an access/refresh token pair, or `null` if the code is invalid, expired,
	 * or already redeemed. Callers must treat null as "send back to /login".
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
	 *
	 * @deprecated Session refresh is session lifecycle, not OAuth — a consumer
	 * that brokers no OAuth still needs it (refreshing a password session, or
	 * revoking on logout). Moved to `IAuthProvider.sessionRefresh`
	 * (`ISessionRefresh`). This member delegates for one release and will be
	 * removed in the next minor; migrate callers to
	 * `auth.sessionRefresh?.refreshSession(...)`.
	 */
	refreshSession(refreshToken: string): Promise<{
		sessionToken: string;
		refreshToken: string;
	} | null>;
}

/**
 * Optional session-lifecycle surface: refresh an expiring session, revoke one
 * server-side. Deliberately not part of `IOAuthAuth` — refresh and revoke are
 * properties of a *session*, regardless of how it was minted. A deployment
 * that brokers no OAuth still needs to revoke on logout.
 *
 * Undefined for providers that can't invalidate a session server-side (the
 * local HMAC provider mints stateless tokens — nothing to revoke). Callers
 * must treat absence as "cookie deletion is all we can do".
 */
export interface ISessionRefresh {
	/**
	 * Swap a refresh token for a fresh access/refresh pair. Returns null on
	 * irrecoverable failure (revoked, expired, signed by a different secret,
	 * or the user has since been disabled); the session-refresh middleware
	 * treats null as "force re-login" by clearing the refresh cookie.
	 */
	refreshSession(refreshToken: string): Promise<{
		sessionToken: string;
		refreshToken: string;
	} | null>;

	/**
	 * Invalidate a session server-side so its token stops being accepted
	 * before it would naturally expire. Called on logout.
	 *
	 * `token` is the session's access token (what the driving layer holds in
	 * its session cookie). Adapters that revoke by refresh token accept
	 * either — the contract is "the credential the caller has".
	 *
	 * Best-effort and idempotent: revoking an already-revoked, expired, or
	 * unknown token returns `true`, since the desired end state (that token
	 * grants nothing) holds either way. Returns `false` only when the provider
	 * couldn't carry out the revocation and the token may still be live —
	 * callers should still clear the cookie but may log the failure. Never
	 * throws: a failed revoke must not block logout.
	 */
	revokeSession(token: string): Promise<boolean>;
}

/**
 * Optional passwordless email surface — "type your email, click the link in
 * your inbox, you're in." Implemented by providers that broker email delivery
 * and token verification (Supabase Auth, future Eterna ID, …). Adapters that
 * can't send mail or don't model this flow leave `IAuthProvider.emailLink`
 * undefined.
 *
 * Two phases, mirroring OAuth's start/callback split:
 *
 *   1. User submits an email → server calls `sendMagicLink(email,
 *      callbackUrl)`. The adapter delivers a link to that callback URL with
 *      whatever verification token shape it uses (Supabase: `?token_hash=…
 *      &type=magiclink`).
 *   2. User clicks the link, browser hits the callback route → server calls
 *      `verifyMagicLink(rawTokenFromUrl)` to mint a session.
 *
 * The route layer never inspects the token — it just forwards the raw URL
 * string. Adapter-specific token shapes stay inside the adapter.
 */
export interface IEmailLinkAuth {
	/**
	 * Send a magic-link email. `callbackUrl` is the absolute URL the adapter
	 * embeds in the link — must point at the route that handles
	 * `verifyMagicLink`.
	 *
	 * Returns `{ ok: false, reason }` for adapter-classified failures (rate
	 * limit, signup disabled, invalid email) so the route can render a
	 * user-friendly message without exposing provider internals. Network or
	 * unknown errors still throw.
	 */
	sendMagicLink(
		email: string,
		callbackUrl: string
	): Promise<
		{ ok: true } | { ok: false; reason: 'rate_limited' | 'signup_disabled' | 'invalid_email' }
	>;

	/**
	 * Verify the token the IdP sent the user. `rawCallbackUrl` is the full URL
	 * the user landed on (or an opaque adapter-specific token string —
	 * adapters document which); the adapter pulls whatever fields it needs.
	 *
	 * Returns `null` for invalid, expired, or already-redeemed tokens —
	 * callers must treat null as "send back to /login". `refreshToken` is
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
 * proxy (HTTP headers, mTLS, etc.) — e.g. Caddy `forward_auth`, oauth2-proxy,
 * Authelia, Pomerium, Traefik forward-auth.
 *
 * TRUST BOUNDARY — READ BEFORE IMPLEMENTING
 *
 * The signals this surface consumes are NOT verified cryptographically by
 * Selva. They're trusted only because the deployment runs the app behind a
 * proxy that:
 *
 *   1. Authenticates the user against an upstream IdP, AND
 *   2. Strips any client-supplied copies of the trusted headers from
 *      inbound requests before adding its own, AND
 *   3. Is the only network path that can reach the app process (bind to
 *      127.0.0.1, firewall the app port, or use a private socket).
 *
 * If any condition fails, an attacker can spoof the headers and become
 * anyone. Each implementer of this interface MUST ship a README stating the
 * exact proxy configuration required — the platform layer can't verify this;
 * it's the provider's contract with its operator.
 *
 * `identifyFromHeaders` is called from `hooks.server.ts` on every authed
 * request whose session cookie is missing or invalid. It must be cheap — a
 * header read plus at most one indexed lookup, no network calls, no
 * unbounded disk scans.
 */
export interface IProxyAuth {
	/**
	 * Identify the caller from trusted upstream-proxy signals on the incoming
	 * request. Returns `null` for "not identified" (header missing, UPN not
	 * allowlisted, account disabled) — must not throw for absent headers,
	 * since that's the normal anonymous case.
	 *
	 * On first identification of a previously-allowlisted user, the
	 * implementation may materialize stored fields (display name, email) from
	 * the same headers. Auto-creating arbitrary users from headers is
	 * forbidden: the allowlist is the security boundary.
	 */
	identifyFromHeaders(headers: Headers): Promise<AuthUser | null>;

	/**
	 * True iff none of the identity headers this provider trusts arrived on
	 * the request. The hook layer uses this on `/login` misses to tell
	 * "proxy never reached us" apart from "proxy is here but didn't recognise
	 * the user", without leaking the trusted header names to end users.
	 */
	hasNoIdentityHeaders(headers: Headers): boolean;

	/** Identity-header names this provider reads. Log output only, never surfaced to end users. */
	readonly configuredHeaderNames: readonly string[];
}

/**
 * Authentication provider — identity verification only. Profile state lives
 * in `IUserProfileStore`, platform permissions in `IPlatformPermissionStore`,
 * password ops in optional `passwordAuth`, OAuth in optional `oauth`.
 *
 * Methods here don't take a `RequestContext` — the provider produces the
 * identity used to build the context, not the other way around.
 */
export interface IAuthProvider {
	/** Display name shown in admin UI (e.g. "Local", "Microsoft Entra ID"). */
	readonly name: string;

	/** Present for credential-owning providers; undefined for OIDC-only. */
	readonly passwordAuth?: IPasswordAuth;

	/** Present for providers that broker OAuth flows; undefined otherwise. */
	readonly oauth?: IOAuthAuth;

	/**
	 * Present for providers that can refresh or revoke a session server-side.
	 * Undefined for providers minting stateless tokens with nothing to revoke.
	 * Independent of `oauth` — a password-only deployment still has sessions.
	 */
	readonly sessionRefresh?: ISessionRefresh;

	/**
	 * Present for providers that send sign-in links over email (Supabase Auth,
	 * future Eterna ID). Undefined otherwise.
	 */
	readonly emailLink?: IEmailLinkAuth;

	/**
	 * Present for providers that derive identity from a trusted upstream
	 * proxy (forward-auth headers, mTLS, etc.). Undefined for credential or
	 * OIDC-broker providers. See `IProxyAuth` for the trust contract.
	 *
	 * When set, the platform treats sign-out as the proxy/IdP's job and skips
	 * the logout button — Selva has no session to destroy.
	 */
	readonly proxyAuth?: IProxyAuth;

	/** Verify a token (session cookie, JWT, ID token, etc.); null if invalid or expired. */
	verifyToken(token: string): Promise<AuthUser | null>;

	getUser(id: string): Promise<AuthUser | null>;

	/** Returns null if the provider does not support user management. */
	listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null>;

	/**
	 * Allowlist a user without a password (OAuth providers). Callers grant
	 * permissions via `IPlatformPermissionStore.set`.
	 */
	createUser?(email: string): Promise<AuthUser>;

	/**
	 * Delete a user identity. Callers must consult
	 * `IPlatformPermissionStore.countInstanceAdminsExcluding(id)` first and
	 * surface `'last_admin'` themselves — the sole-`instance_admin` invariant
	 * isn't enforced here.
	 */
	deleteUser(id: string): Promise<UserManagementResult>;

	/**
	 * Disable a user, preserving identity (preferred over deletion). Same
	 * invariant rules as `deleteUser`.
	 *
	 * Existing sessions aren't guaranteed to stop working the instant this
	 * returns — adapters that verify tokens locally may keep accepting an
	 * already-issued access token until their next revalidation (the Supabase
	 * adapter bounds this by `revalidateMs`, default 60s). Callers needing
	 * immediate cutoff should also revoke via `sessionRefresh.revokeSession`.
	 */
	disableUser(id: string): Promise<UserManagementResult>;

	/**
	 * Stamp `lastLoginAt`. Best-effort — failure must not block auth. Adapters
	 * may debounce (e.g. skip if the existing timestamp is under 60s old).
	 */
	touchLastLogin?(id: string): Promise<void>;
}
