/**
 * Authentication provider interface.
 *
 * Implement this to plug in any auth backend:
 * - Local HMAC sessions (built-in default)
 * - Firebase Auth
 * - Supabase Auth
 * - AWS Cognito
 * - Any OIDC/JWT provider
 */

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface AuthUser {
	id: string;
	email?: string;
	role: UserRole;
	metadata?: Record<string, unknown>;
}

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
	 * Stored in a cookie by the transport layer. Format is provider-specific:
	 * HMAC string, signed JWT, Firebase custom token, etc.
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
	 * List all users. Returns null if this provider does not support user management
	 * (e.g. single-password mode).
	 */
	listUsers(): Promise<AuthUser[] | null>;

	/**
	 * Create a new user. Returns null if not supported.
	 */
	createUser(email: string, password: string, role: UserRole): Promise<AuthUser | null>;

	/**
	 * Update a user's role. Returns false if not supported or user not found.
	 */
	updateUserRole(id: string, role: UserRole): Promise<boolean>;

	/**
	 * Delete a user by ID. Returns false if not supported or user not found.
	 */
	deleteUser(id: string): Promise<boolean>;
}
