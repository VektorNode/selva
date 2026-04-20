import type { AuthUser, Permission, UserManagementResult } from './types.js';
import type { ListOptions, Page } from '../pagination.js';

/**
 * Describes what an auth provider supports, so the UI and API routes can
 * adapt without hardcoding provider-specific logic.
 */
export interface AuthProviderCapabilities {
	/** Human-readable name shown in the admin UI (e.g. "Local", "GitHub", "Firebase"). */
	name: string;
	/**
	 * How admin-initiated user creation works:
	 * - 'email-password' — admin sets both email and password (local provider)
	 * - 'email-only'     — admin allowlists an email; user authenticates via OAuth
	 * - 'none'           — provider manages users externally (no in-app creation)
	 */
	userCreation: 'email-password' | 'email-only' | 'none';
	/**
	 * Whether end-users can self-register via /signup.
	 * OAuth providers handle this via their own callback; local providers use registerUser().
	 */
	selfRegistration: boolean;
	/** Whether password reset is supported. */
	passwordReset: boolean;
}

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
	/** Describes what this provider supports — used to adapt UI and API routes. */
	readonly capabilities: AuthProviderCapabilities;
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
	 *
	 * Note: OAuth providers should return null (not supported). User creation happens
	 * during the OAuth callback flow, not via this method.
	 */
	verifyLoginCredentials(email: string, password: string): Promise<AuthUser | null>;

	// ============================================================================
	// User management
	// ============================================================================

	/**
	 * List users with pagination. Returns null if this provider does not
	 * support user management (distinct from an empty page).
	 */
	listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null>;

	/**
	 * Admin-initiated user creation.
	 * - password is required for 'email-password' providers (local)
	 * - password should be null for 'email-only' providers (OAuth allowlist)
	 * Returns null if this provider does not support admin user creation.
	 */
	createUser(email: string, password: string | null, permissions: Permission[]): Promise<AuthUser | null>;

	/**
	 * Self-service user registration — called from /signup, not /admin.
	 * Returns the new user, or null if self-registration is not supported.
	 * OAuth providers omit this; their OAuth callback IS the registration.
	 */
	registerUser?(email: string, password: string): Promise<AuthUser | null>;

	/** Update a user's permissions. Returns 'ok', 'not_found', or 'not_supported'. */
	updateUserPermissions(id: string, permissions: Permission[]): Promise<UserManagementResult>;

	/** Delete a user by ID. Returns 'ok', 'not_found', or 'not_supported'. */
	deleteUser(id: string): Promise<UserManagementResult>;

	// ============================================================================
	// Password reset (optional)
	// ============================================================================

	/**
	 * Request a password reset for a user (email-based flow).
	 * Returns 'ok' if reset email was sent, 'not_found' if user doesn't exist,
	 * 'not_supported' if this provider doesn't support password resets.
	 *
	 * The provider is responsible for:
	 * - Sending the reset email with a token/link
	 * - Validating the token when the user clicks the link
	 * - Handling token expiration
	 *
	 * OAuth providers should return 'not_supported' — password resets are handled
	 * on the OAuth provider's platform.
	 */
	requestPasswordReset(email: string): Promise<UserManagementResult>;

	/**
	 * Complete a password reset with a provider-specific token.
	 * Returns 'ok' on success, 'not_found' if token is invalid/expired,
	 * 'not_supported' if this provider doesn't implement password resets.
	 */
	completePasswordReset(token: string, newPassword: string): Promise<UserManagementResult>;
}
