import { z } from 'zod';

/**
 * Platform-scope permissions. Very limited on purpose — only rights that
 * apply *across* every organization on the instance. Regular users hold an
 * empty array; these are reserved for Selva-staff roles and instance operators.
 *
 * - `instance_admin`        — superuser across all orgs; implies every
 *   OrgPermission everywhere plus every other platform permission.
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

/** Convenience: every platform permission. */
export const ALL_PLATFORM_PERMISSIONS: readonly PlatformPermission[] = PlatformPermissionSchema.options;

export interface RecentRun {
	definitionId: string;
	runId: string;
	definitionName: string;
	timestamp: string; // ISO 8601
}

/**
 * Identity record returned by an auth provider.
 *
 * Carries only what identity providers universally own: id, email, lifecycle
 * timestamps, platform-scope permissions. Profile state (displayName,
 * starredDefinitions, recentRuns) lives on `UserProfile` in `IUserProfileStore`
 * so OIDC providers (Supabase Auth, Entra, Firebase) don't have to stub out
 * fields they can't own. Callers that need both request them as a pair.
 */
export interface AuthUser {
	id: string;
	email?: string;
	/** Platform-scope permissions. Typically empty; non-empty for Selva-staff roles. */
	platformPermissions: PlatformPermission[];
	/** Provider-specific data only — do not store sensitive user information (PII, credentials, tokens). */
	metadata?: Record<string, unknown>;

	/** ISO 8601 — when the user record was first created. */
	createdAt?: string;
	/**
	 * ISO 8601 — most recent successful token verification or credential login.
	 * Provider-updated only; never writable from the client.
	 * Adapters MAY debounce writes (e.g. once per minute) to avoid a write per request.
	 */
	lastLoginAt?: string;
	/**
	 * When true, `verifyToken` and `verifyLogin` MUST return failure.
	 * Preserves audit trail — prefer disabling over deletion for offboarding,
	 * compromise response, or any case where history must be retained.
	 */
	disabled?: boolean;
}

/**
 * Result type for user-management mutations that can fail in distinct ways.
 * - 'ok'            — operation succeeded
 * - 'not_found'     — the target user does not exist
 * - 'not_supported' — this provider does not implement user management
 */
export type UserManagementResult = 'ok' | 'not_found' | 'not_supported';

/**
 * MFA factor metadata returned when a login succeeds at the first step but
 * needs a second-factor challenge. Providers that don't support MFA never
 * emit this variant and return `success` / `failed` only.
 */
export interface MfaFactor {
	/** Opaque provider-specific id used with `verifyMfaChallenge`. */
	id: string;
	type: 'totp' | 'phone';
	/** Optional human-readable label shown to the user (e.g. "Authenticator app"). */
	friendlyName?: string;
}

/**
 * Discriminated login outcome.
 *
 * - `success` — credentials valid, no further factor needed. Includes the
 *   session token the provider minted so the caller can set the cookie
 *   without a separate round-trip.
 * - `mfa_required` — credentials valid, but the user has an enrolled MFA
 *   factor. The caller presents a challenge UI and calls
 *   `verifyMfaChallenge(challengeToken, factorId, code)` to finish.
 * - `failed` — credentials invalid, user disabled, or rate-limited. `reason`
 *   is a hint only; UI should use a generic message regardless.
 */
export type LoginResult =
	| { kind: 'success'; user: AuthUser; sessionToken: string }
	| { kind: 'mfa_required'; challengeToken: string; factors: MfaFactor[] }
	| { kind: 'failed'; reason?: 'invalid_credentials' | 'disabled' | 'rate_limited' };
