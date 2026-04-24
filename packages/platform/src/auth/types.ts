import { z } from 'zod';

/**
 * Fine-grained platform permissions.
 * A user may hold any combination. 'platform_admin' implies all others.
 */
export const PermissionSchema = z.enum([
	'platform_admin',     // superuser — implies all permissions below
	'manage_users',       // create / edit / delete users
	'manage_compute',     // configure compute servers
	'manage_definitions', // upload / edit / delete definitions
	'manage_projects'     // create / edit / delete projects
]);
export type Permission = z.infer<typeof PermissionSchema>;

/** Convenience: every permission, including the implied-everything 'platform_admin'. */
export const ALL_PERMISSIONS: readonly Permission[] = PermissionSchema.options;

/** Returns true if the permission set grants the requested permission. */
export function hasPermission(permissions: readonly Permission[], permission: Permission): boolean {
	return permissions.includes('platform_admin') || permissions.includes(permission);
}

export interface RecentRun {
	definitionId: string;
	runId: string;
	definitionName: string;
	timestamp: string; // ISO 8601
}

export interface AuthUser {
	id: string;
	email?: string;
	displayName?: string;
	permissions: Permission[];
	/** Definition GUIDs pinned by this user for quick access. */
	starredDefinitions: string[];
	/** Last N solve runs across all definitions, newest first. */
	recentRuns: RecentRun[];
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
	 * When true, verifyToken and verifyLoginCredentials MUST return null.
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
