/**
 * Fine-grained platform permissions.
 * A user may hold any combination. 'platform_admin' implies all others.
 */
export type Permission =
	| 'platform_admin'      // superuser — implies all permissions below
	| 'manage_users'        // create / edit / delete users
	| 'manage_compute'      // configure compute servers
	| 'manage_definitions'  // upload / edit / delete definitions
	| 'manage_projects';    // create / edit / delete projects

/** Convenience: all permissions implied by platform_admin */
export const ALL_PERMISSIONS: Permission[] = [
	'platform_admin',
	'manage_users',
	'manage_compute',
	'manage_definitions',
	'manage_projects'
];

/** Returns true if the permission set grants the requested permission. */
export function hasPermission(permissions: Permission[], permission: Permission): boolean {
	return permissions.includes('platform_admin') || permissions.includes(permission);
}

export interface AuthUser {
	id: string;
	email?: string;
	displayName?: string;
	permissions: Permission[];
	/** Provider-specific data only — do not store sensitive user information (PII, credentials, tokens). */
	metadata?: Record<string, unknown>;
}

/**
 * Result type for user-management mutations that can fail in distinct ways.
 * - 'ok'            — operation succeeded
 * - 'not_found'     — the target user does not exist
 * - 'not_supported' — this provider does not implement user management
 */
export type UserManagementResult = 'ok' | 'not_found' | 'not_supported';
