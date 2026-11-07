/**
 * Identity record from an auth provider. Pure identity — no Selva-specific
 * authorization or profile state. Platform permissions live in
 * `IPlatformPermissionStore`; profile state lives in `IUserProfileStore`.
 */
export interface AuthUser {
	id: string;
	email?: string;
	/**
	 * Provider-specific, and may hold personal data (header auth keeps the UPN and display
	 * name here, Supabase passes its `user_metadata` through), so never log it. Never holds
	 * credentials or tokens.
	 */
	metadata?: Record<string, unknown>;
	createdAt?: string;
	/**
	 * When the identity provider last let this person in: a password or OAuth
	 * sign-in, or a proxied visit under proxy auth. A session refresh never
	 * moves it. `SIGN_IN_MAX_AGE_DAYS` reads it, so moving it on refresh would
	 * switch that check off. Provider-updated only; never client-writable.
	 */
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

/**
 * `success` includes the session token the provider minted. `rate_limited` is for
 * providers that throttle logins; no bundled provider returns it.
 */
export type LoginResult =
	| { kind: 'success'; user: AuthUser; sessionToken: string }
	| { kind: 'failed'; reason?: 'invalid_credentials' | 'disabled' | 'rate_limited' };
