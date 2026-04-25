import { z } from 'zod';

/**
 * Platform-scope permissions. Very limited on purpose — reserved for
 * Selva-staff and instance operators. Regular users hold an empty array.
 *
 * - `instance_admin`        — superuser; implies every other permission.
 * - `manage_compute`        — configure the instance-wide Rhino.Compute pool.
 * - `manage_instance_users` — disable/enable any user on the instance.
 * - `manage_updates`        — run system updates.
 */
export const PlatformPermissionSchema = z.enum([
	'instance_admin',
	'manage_compute',
	'manage_instance_users',
	'manage_updates'
]);
export type PlatformPermission = z.infer<typeof PlatformPermissionSchema>;

export const ALL_PLATFORM_PERMISSIONS: readonly PlatformPermission[] = PlatformPermissionSchema.options;

export interface RecentRun {
	definitionId: string;
	runId: string;
	definitionName: string;
	timestamp: string;
}

/**
 * Identity record from an auth provider. Pure identity — no Selva-specific
 * authorization or profile state. `platformPermissions` lives in
 * `IPlatformPermissionStore` (data layer); profile state (displayName,
 * starredDefinitions, recentRuns) lives in `IUserProfileStore`. Both seams
 * exist so external IdPs (Supabase Auth, Entra, Firebase) don't need to
 * model anything Selva-specific.
 */
export interface AuthUser {
	id: string;
	email?: string;
	/** Provider-specific only — never PII, credentials, or tokens. */
	metadata?: Record<string, unknown>;
	createdAt?: string;
	/**
	 * Provider-updated only; never client-writable. Adapters may debounce
	 * writes (e.g. once per minute) to avoid a write per request.
	 */
	lastLoginAt?: string;
	/**
	 * When true, `verifyToken` and `verifyLogin` MUST fail. Prefer disabling
	 * over deletion so the audit trail survives.
	 */
	disabled?: boolean;
}

/**
 * - 'ok'            — succeeded
 * - 'not_found'     — target user doesn't exist
 * - 'not_supported' — provider doesn't implement user management
 * - 'last_admin'    — refused; would leave the instance with zero `instance_admin` users.
 *                     See Permissions.md §2 invariant + §10 sole-admin offboarding rule.
 */
export type UserManagementResult = 'ok' | 'not_found' | 'not_supported' | 'last_admin';

/**
 * Provider-specific MFA factor. Providers that don't support MFA never emit
 * the `mfa_required` login variant and can ignore this type.
 */
export interface MfaFactor {
	id: string;
	type: 'totp' | 'phone';
	friendlyName?: string;
}

/**
 * - `success` — credentials valid; includes the session token the provider
 *   minted so the caller can set the cookie without a round-trip.
 * - `mfa_required` — credentials valid but MFA enrolled; caller presents the
 *   challenge UI and invokes `verifyMfaChallenge`.
 * - `failed` — credentials invalid, user disabled, or rate-limited. `reason`
 *   is a hint only; UI should show a generic message.
 */
export type LoginResult =
	| { kind: 'success'; user: AuthUser; sessionToken: string }
	| { kind: 'mfa_required'; challengeToken: string; factors: MfaFactor[] }
	| { kind: 'failed'; reason?: 'invalid_credentials' | 'disabled' | 'rate_limited' };
