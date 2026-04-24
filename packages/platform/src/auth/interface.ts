import type {
	AuthUser,
	LoginResult,
	MfaFactor,
	PlatformPermission,
	UserManagementResult
} from './types.js';
import type { ListOptions, Page } from '../pagination.js';

/**
 * Optional password-based authentication surface. Implemented by providers
 * that own credentials (LocalAuthProvider, Supabase Auth). OIDC / OAuth-only
 * providers (Entra, Firebase) leave `IAuthProvider.passwordAuth` undefined.
 *
 * Login returns a `LoginResult` so the caller gets the session token in the
 * same round-trip — matches Supabase's `signInWithPassword` shape and lets
 * local-HMAC providers inline the sign step. Providers without MFA only ever
 * return `success` / `failed`; MFA-capable providers additionally emit
 * `mfa_required` and expose the challenge methods below.
 */
export interface IPasswordAuth {
	/**
	 * Verify credentials in a single call. Returns a discriminated union:
	 * `success` (with the minted sessionToken), `mfa_required` (challenge
	 * pending), or `failed`. Callers must `switch (result.kind)` — never
	 * treat truthiness as authenticated.
	 *
	 * Email may be empty for password-only modes (no users.json configured).
	 */
	verifyLogin(email: string, password: string): Promise<LoginResult>;

	/** Admin-initiated user creation with a known password. */
	createUserWithPassword(
		email: string,
		password: string,
		platformPermissions: PlatformPermission[]
	): Promise<AuthUser>;

	/**
	 * Self-service registration (called from /signup). Return null when
	 * self-registration is disabled.
	 */
	registerUser?(email: string, password: string): Promise<AuthUser | null>;

	/**
	 * Optional password-reset flow. Provider sends the email with token,
	 * validates the token, and writes the new hash.
	 */
	requestPasswordReset?(email: string): Promise<UserManagementResult>;
	completePasswordReset?(token: string, newPassword: string): Promise<UserManagementResult>;

	// ── Optional MFA surface ────────────────────────────────────────────────
	// Providers that don't support MFA leave every method below undefined.
	// Callers check `provider.passwordAuth?.enrollMfa` before showing UI.

	/**
	 * Complete a login after `verifyLogin` returned `mfa_required`.
	 * Returns `{user, sessionToken}` on success, null on wrong code / expired
	 * challenge / disabled user.
	 */
	verifyMfaChallenge?(
		challengeToken: string,
		factorId: string,
		code: string
	): Promise<{ user: AuthUser; sessionToken: string } | null>;

	/**
	 * Start enrolling a new MFA factor. `qrCodeUrl` is the `otpauth://` URI
	 * for TOTP enrolment; `secret` is the same secret base32-encoded for
	 * manual entry. Providers that only support phone factors return the
	 * factor id alone and deliver the code out-of-band.
	 */
	enrollMfa?(
		userId: string,
		type: 'totp' | 'phone'
	): Promise<{ factorId: string; qrCodeUrl?: string; secret?: string }>;

	/** Confirm an MFA enrolment with the first code the user produces. */
	confirmMfaEnrollment?(factorId: string, code: string): Promise<UserManagementResult>;

	/** Remove an enrolled factor. */
	unenrollMfa?(userId: string, factorId: string): Promise<UserManagementResult>;

	/** List factors currently enrolled for a user. Used by the profile page. */
	listMfaFactors?(userId: string): Promise<MfaFactor[]>;
}

/**
 * Authentication provider interface — identity verification only.
 * User-profile state (starred defs, recent runs, display name) lives in
 * `IUserProfileStore`. Password operations live in optional `passwordAuth`.
 *
 * ## Scope
 *
 * This interface owns **platform-level identity + platform permissions only**.
 * Per-org memberships and `OrgPermission`s live on `IOrgStore` (`OrgMember`
 * records). `createUser` / `updateUserPlatformPermissions` here operate on
 * the rare platform-scope role set (typically just `platform_admin`); to
 * give a user rights inside an org, call `IOrgStore.addOrgMember` /
 * `updateOrgMemberRole`.
 *
 * Implement to plug in any auth backend: local HMAC sessions, Microsoft
 * Entra ID, Supabase Auth, Firebase Auth, AWS Cognito, any OIDC/JWT provider.
 *
 * NOTE: Auth provider methods do NOT take a RequestContext — the provider is
 * what *produces* the identity used to build the context. Callers at the
 * HTTP boundary (hooks.server.ts) derive the context from the returned user.
 */
export interface IAuthProvider {
	/** Display name shown in the admin UI (e.g. "Local", "Microsoft Entra ID"). */
	readonly name: string;

	/**
	 * Optional password-based auth surface. Present for local providers;
	 * undefined for OIDC providers that delegate password handling externally.
	 */
	readonly passwordAuth?: IPasswordAuth;

	/**
	 * Verify a token string — session cookie value, JWT, Firebase ID token, etc.
	 * Returns the authenticated user, or null if the token is invalid or expired.
	 */
	verifyToken(token: string): Promise<AuthUser | null>;

	/** Look up a user by their provider-specific ID. Returns null if not found. */
	getUser(id: string): Promise<AuthUser | null>;

	/**
	 * List users with pagination. Returns null if this provider does not
	 * support user management (distinct from an empty page).
	 */
	listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null>;

	/**
	 * Optional: allowlist a user (no password). Implemented by OAuth providers
	 * where the user authenticates via the upstream IdP. Providers that
	 * require passwords expose creation through `passwordAuth.createUserWithPassword`
	 * and leave this undefined.
	 */
	createUser?(email: string, platformPermissions: PlatformPermission[]): Promise<AuthUser>;

	/** Update a user's platform-scope permissions. Returns 'ok', 'not_found', or 'not_supported'. */
	updateUserPlatformPermissions(
		id: string,
		platformPermissions: PlatformPermission[]
	): Promise<UserManagementResult>;

	/** Delete a user. Returns 'ok', 'not_found', or 'not_supported'. */
	deleteUser(id: string): Promise<UserManagementResult>;

	/**
	 * Stamp the user's `lastLoginAt` to now. Called by the auth entry points
	 * (`verifyLogin` and `verifyToken`) on success. Best-effort — failure
	 * MUST NOT block auth. Adapters MAY debounce (e.g. skip if the existing
	 * timestamp is < 60s old) to avoid a write per request. Omitted on
	 * providers that cannot persist user state.
	 */
	touchLastLogin?(id: string): Promise<void>;
}
