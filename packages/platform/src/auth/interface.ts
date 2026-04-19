import type { AuthUser, Permission } from './types.js';
import type { ListOptions, Page } from '../pagination.js';

/**
 * Authentication provider interface.
 *
 * Implement to plug in any auth backend:
 * - Local HMAC sessions (built-in default)
 * - Firebase Auth
 * - Supabase Auth
 * - AWS Cognito
 * - Any OIDC/JWT provider
 *
 * NOTE: Auth provider methods do NOT take a RequestContext. The provider is
 * what *produces* the identity used to build the context — callers at the
 * HTTP boundary (hooks.server.ts) derive the context from the returned user.
 */
export interface IAuthProvider {
	/**
	 * Verify a token string — session cookie value, JWT, Firebase ID token, etc.
	 * Returns the authenticated user, or null if the token is invalid or expired.
	 */
	verifyToken(token: string): Promise<AuthUser | null>;

	/**
	 * Look up a user by their provider-specific ID.
	 * Returns null if the user does not exist.
	 */
	getUser(id: string): Promise<AuthUser | null>;

	/**
	 * Create a new opaque session token for an authenticated user.
	 * Format is provider-specific: HMAC string, signed JWT, Firebase custom token, etc.
	 */
	createSessionToken(user: AuthUser): Promise<string>;

	/**
	 * Verify login credentials (email + password).
	 * Returns the authenticated user, or null if credentials are invalid.
	 * Email may be an empty string for password-only auth (no users.json configured).
	 */
	verifyLoginCredentials(email: string, password: string): Promise<AuthUser | null>;

	// ── User management ────────────────────────────────────────────────────────

	/**
	 * List users with pagination. Returns null if this provider does not
	 * support user management (distinct from an empty page).
	 */
	listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null>;

	/** Create a new user. Returns null if not supported. */
	createUser(email: string, password: string, permissions: Permission[]): Promise<AuthUser | null>;

	/** Update a user's permissions. Returns false if not supported or user not found. */
	updateUserPermissions(id: string, permissions: Permission[]): Promise<boolean>;

	/** Delete a user by ID. Returns false if not supported or user not found. */
	deleteUser(id: string): Promise<boolean>;
}
