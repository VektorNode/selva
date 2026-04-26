/**
 * Identity record from an auth provider. Pure identity — no Selva-specific
 * authorization or profile state. Platform permissions live in
 * `IPlatformPermissionStore`; profile state lives in `IUserProfileStore`.
 */
export interface AuthUser {
	id: string;
	email?: string;
	/** Provider-specific only — never PII, credentials, or tokens. */
	metadata?: Record<string, unknown>;
	createdAt?: string;
	/** Provider-updated only; never client-writable. */
	lastLoginAt?: string;
	/** When true, `verifyToken` and `verifyLogin` MUST fail. Prefer over deletion. */
	disabled?: boolean;
}

/**
 * - `ok`            — succeeded
 * - `not_found`     — target user doesn't exist
 * - `not_supported` — provider doesn't implement user management
 * - `last_admin`    — refused; would leave zero `instance_admin` users
 */
export type UserManagementResult = 'ok' | 'not_found' | 'not_supported' | 'last_admin';

export interface MfaFactor {
	id: string;
	type: 'totp' | 'phone';
	friendlyName?: string;
}

/**
 * - `success` — credentials valid; includes session token the provider minted.
 * - `mfa_required` — credentials valid but MFA enrolled; caller invokes `verifyMfaChallenge`.
 * - `failed` — credentials invalid, user disabled, or rate-limited.
 */
export type LoginResult =
	| { kind: 'success'; user: AuthUser; sessionToken: string }
	| { kind: 'mfa_required'; challengeToken: string; factors: MfaFactor[] }
	| { kind: 'failed'; reason?: 'invalid_credentials' | 'disabled' | 'rate_limited' };
