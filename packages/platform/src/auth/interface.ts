import type { AuthUser, LoginResult, UserManagementResult } from './types.js';
import type { ListOptions, Page } from '../pagination.js';

/** Password sign-in, for providers that own credentials. */
export interface IPasswordAuth {
	/** Callers must `switch (result.kind)`: a failed result is an object too. */
	verifyLogin(email: string, password: string): Promise<LoginResult>;

	/** Grants no platform permissions: set those with `IPlatformPermissionStore.set`. */
	createUserWithPassword(email: string, password: string): Promise<AuthUser>;

	/** Null when self-registration is off. */
	registerUser?(email: string, password: string): Promise<AuthUser | null>;
}

/**
 * OAuth authorization-code flow, for providers that broker one. A code that can never work
 * returns `null` rather than throwing, so the caller can tell "sign in again" from a fault.
 */
export interface IOAuthAuth {
	/** Configured providers as lowercase ids ("google", "github"); empty when none. */
	listProviders(): readonly string[];

	/**
	 * The IdP URL to send the browser to. `redirectTo` is the route that exchanges the
	 * returned `?code=`. The caller validates `provider`: an unconfigured one may fail upstream.
	 */
	getOAuthAuthorizationUrl(
		provider: 'google' | 'github' | 'azure' | 'gitlab',
		redirectTo: string
	): Promise<string>;

	/** The identity and session pair for a code; `null` if it is invalid, expired or redeemed. */
	exchangeOAuthCode(code: string): Promise<{
		user: AuthUser;
		sessionToken: string;
		refreshToken: string;
	} | null>;
}

/**
 * Refreshing and revoking a session, whatever minted it. Absent on providers whose tokens
 * can't be revoked server-side: deleting the cookie is then all a caller can do.
 */
export interface ISessionRefresh {
	/**
	 * A fresh pair for a refresh token, or `null` when it will never work again (revoked,
	 * expired, signed by another secret, or the user disabled). Callers treat null as
	 * "sign in again".
	 */
	refreshSession(refreshToken: string): Promise<{
		sessionToken: string;
		refreshToken: string;
	} | null>;

	/**
	 * Stops `token` being accepted before it expires. `token` is the access token; an
	 * adapter that revokes by refresh token accepts either.
	 *
	 * Idempotent: an already revoked, expired or unknown token returns `true`, since it
	 * grants nothing either way. `false` means the revoke failed and the token may still
	 * work. Never throws: a failed revoke must not block sign-out.
	 */
	revokeSession(token: string): Promise<boolean>;
}

/**
 * Passwordless sign-in through a link sent by email. The caller forwards the URL the user
 * landed on without reading it; the token's shape is the adapter's business.
 */
export interface IEmailLinkAuth {
	/**
	 * Sends a link to `callbackUrl`, the absolute URL of the route that calls
	 * `verifyMagicLink`. Returns `{ ok: false, reason }` for failures the user can act on;
	 * throws for network and unknown errors.
	 */
	sendMagicLink(
		email: string,
		callbackUrl: string
	): Promise<
		{ ok: true } | { ok: false; reason: 'rate_limited' | 'signup_disabled' | 'invalid_email' }
	>;

	/**
	 * The identity and session for the URL the user landed on (or an adapter-specific token
	 * string); `null` if the token is invalid, expired or redeemed. `refreshToken` comes only
	 * from adapters that issue one for these sessions.
	 */
	verifyMagicLink(rawCallbackUrl: string): Promise<{
		user: AuthUser;
		sessionToken: string;
		refreshToken?: string;
	} | null>;
}

/**
 * Identity from signals a trusted reverse proxy injects (headers, mTLS): Caddy
 * `forward_auth`, oauth2-proxy, Authelia and the like.
 *
 * TRUST BOUNDARY — READ BEFORE IMPLEMENTING
 *
 * Selva does not verify these signals. They are safe only behind a proxy that:
 *
 *   1. Authenticates the user against an upstream IdP, AND
 *   2. Strips any client-supplied copies of the trusted headers before adding its own, AND
 *   3. Is the only network path to the app (loopback bind, firewalled port, private socket).
 *
 * If any condition fails, anyone can spoof the headers and become anyone. Every
 * implementation MUST ship a README stating the exact proxy configuration: the platform
 * can't check it.
 *
 * `identifyFromHeaders` runs on every request without a valid session, so it must be cheap:
 * a header read and at most one indexed lookup, no network calls.
 */
export interface IProxyAuth {
	/**
	 * The caller, or `null` when not identified (header missing, not allowlisted, disabled).
	 * Must not throw for absent headers: that is the normal anonymous case.
	 *
	 * May fill stored fields (display name, email) from the headers for an allowlisted user,
	 * but never creates one: the allowlist is the security boundary.
	 */
	identifyFromHeaders(headers: Headers): Promise<AuthUser | null>;

	/**
	 * True when none of the trusted identity headers arrived. Tells "the proxy never reached
	 * us" from "the proxy didn't recognise the user" without naming the headers to users.
	 */
	hasNoIdentityHeaders(headers: Headers): boolean;

	/** Identity-header names this provider reads. Log output only, never surfaced to end users. */
	readonly configuredHeaderNames: readonly string[];
}

export type DelegatedSessionStatus = { ok: true } | { ok: false; message: string };

/**
 * Signs a short-lived session for a user without their credentials, so an API
 * token request runs under the same row security as that user's browser
 * session. Only providers whose stores scope queries by a user session need
 * it; without it their stores see an anonymous caller.
 *
 * Nothing can revoke a minted session before it expires, so callers must
 * re-check the user (disabled, still a member) before every `mint`.
 */
export interface IDelegatedSession {
	/**
	 * Whether minting works with the configured key. A failure switches API
	 * tokens off; browser sign-in is unaffected.
	 */
	status(): Promise<DelegatedSessionStatus>;

	/**
	 * A session token acting as `userId` inside `orgId`, for a lifetime the adapter sets. It
	 * carries no instance-admin rights, whatever the user holds: those never ride on a bearer
	 * key. Throws if `status` isn't ok.
	 */
	mint(userId: string, opts: { orgId: string }): Promise<string>;
}

/**
 * Identity only: profile state lives in `IUserProfileStore`, platform permissions in
 * `IPlatformPermissionStore`. Methods take no `RequestContext`: the provider produces the
 * identity a context is built from.
 */
export interface IAuthProvider {
	/** Shown in the admin UI ("Local", "Microsoft Entra ID"). */
	readonly name: string;

	readonly passwordAuth?: IPasswordAuth;

	readonly oauth?: IOAuthAuth;

	readonly sessionRefresh?: ISessionRefresh;

	readonly emailLink?: IEmailLinkAuth;

	/** When set, signing out is the proxy's job and Selva offers no sign-out. */
	readonly proxyAuth?: IProxyAuth;

	/** For providers whose stores scope by a user session: API-token requests act as the owner. */
	readonly delegatedSession?: IDelegatedSession;

	/** The user for a session token, JWT or ID token; null if invalid or expired. */
	verifyToken(token: string): Promise<AuthUser | null>;

	getUser(id: string): Promise<AuthUser | null>;

	/** Null when the provider can't list users. */
	listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null>;

	/** Allowlists a user with no password (OAuth). Grants no platform permissions. */
	createUser?(email: string): Promise<AuthUser>;

	/**
	 * Does not enforce the last-`instance_admin` rule: callers check
	 * `IPlatformPermissionStore.countInstanceAdminsExcluding(id)` first and return
	 * `'last_admin'` themselves.
	 */
	deleteUser(id: string): Promise<UserManagementResult>;

	/**
	 * Keeps the identity; prefer it to deletion. Callers enforce the last-admin rule as for
	 * `deleteUser`. A session issued before the call may keep working until the adapter next
	 * revalidates it; also call `sessionRefresh.revokeSession` for an immediate cutoff.
	 */
	disableUser(id: string): Promise<UserManagementResult>;

	/** Stamps `lastLoginAt`. Best-effort: a failure must not block sign-in. May debounce. */
	touchLastLogin?(id: string): Promise<void>;
}
