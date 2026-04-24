import type { AuthUser, Permission, UserManagementResult } from './types.js';
import type { ListOptions, Page } from '../pagination.js';

/**
 * Optional password-based authentication surface. Implemented by providers
 * that own credentials (LocalAuthProvider). OIDC / OAuth providers (Entra,
 * Supabase Auth, Firebase) leave `IAuthProvider.passwordAuth` undefined.
 */
export interface IPasswordAuth {
	/**
	 * Verify login credentials.
	 * Email may be empty for password-only modes (no users.json configured).
	 */
	verifyLoginCredentials(email: string, password: string): Promise<AuthUser | null>;

	/** Admin-initiated user creation with a known password. */
	createUserWithPassword(
		email: string,
		password: string,
		permissions: Permission[]
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
}

/**
 * Authentication provider interface — identity verification only.
 * User-profile state (starred defs, recent runs, display name) lives in
 * `IUserProfileStore`. Password operations live in optional `passwordAuth`.
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
	 * Create a new opaque session token for an authenticated user.
	 * Format is provider-specific: HMAC string, signed JWT, custom token, etc.
	 */
	createSessionToken(user: AuthUser): Promise<string>;

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
	createUser?(email: string, permissions: Permission[]): Promise<AuthUser>;

	/** Update a user's permissions. Returns 'ok', 'not_found', or 'not_supported'. */
	updateUserPermissions(id: string, permissions: Permission[]): Promise<UserManagementResult>;

	/** Delete a user. Returns 'ok', 'not_found', or 'not_supported'. */
	deleteUser(id: string): Promise<UserManagementResult>;
}
