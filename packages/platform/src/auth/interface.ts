import type { AuthUser, LoginResult, MfaFactor, UserManagementResult } from './types.js';
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

	requestPasswordReset?(email: string): Promise<UserManagementResult>;
	completePasswordReset?(token: string, newPassword: string): Promise<UserManagementResult>;

	// MFA — providers that don't support MFA leave every method below undefined.

	/** Complete login after `verifyLogin` returned `mfa_required`. */
	verifyMfaChallenge?(
		challengeToken: string,
		factorId: string,
		code: string
	): Promise<{ user: AuthUser; sessionToken: string } | null>;

	/**
	 * Start enrolling a factor. `qrCodeUrl` is the `otpauth://` URI for TOTP;
	 * `secret` is the same secret base32-encoded for manual entry.
	 */
	enrollMfa?(
		userId: string,
		type: 'totp' | 'phone'
	): Promise<{ factorId: string; qrCodeUrl?: string; secret?: string }>;

	confirmMfaEnrollment?(factorId: string, code: string): Promise<UserManagementResult>;
	unenrollMfa?(userId: string, factorId: string): Promise<UserManagementResult>;
	listMfaFactors?(userId: string): Promise<MfaFactor[]>;
}

/**
 * Authentication provider — identity verification only. Profile state lives
 * in `IUserProfileStore`, platform permissions in `IPlatformPermissionStore`,
 * password ops in optional `passwordAuth`.
 *
 * Methods here do NOT take a `RequestContext` — the provider produces the
 * identity used to *build* the context.
 */
export interface IAuthProvider {
	/** Display name shown in admin UI (e.g. "Local", "Microsoft Entra ID"). */
	readonly name: string;

	/** Present for credential-owning providers; undefined for OIDC-only. */
	readonly passwordAuth?: IPasswordAuth;

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
