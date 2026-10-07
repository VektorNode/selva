import { z } from 'zod';

/**
 * Platform-scope permissions. All but `manage_api_tokens` are reserved for
 * Selva staff and instance operators; regular users hold an empty array.
 *
 * - `instance_admin`        — superuser; implies every other permission
 * - `manage_compute`        — configure the instance-wide Rhino.Compute pool
 * - `manage_instance_users` — disable/enable any user on the instance
 * - `manage_updates`        — run system updates
 * - `manage_api_tokens`     — mint API tokens for yourself
 */
export const PlatformPermissionSchema = z.enum([
	'instance_admin',
	'manage_compute',
	'manage_instance_users',
	'manage_updates',
	'manage_api_tokens'
]);
export type PlatformPermission = z.infer<typeof PlatformPermissionSchema>;

export const ALL_PLATFORM_PERMISSIONS: readonly PlatformPermission[] =
	PlatformPermissionSchema.options;

/**
 * The permissions that admit someone to the `/admin` operator surface.
 * `manage_api_tokens` is granted to ordinary users, who have no business there.
 */
export const OPERATOR_PLATFORM_PERMISSIONS: readonly PlatformPermission[] =
	ALL_PLATFORM_PERMISSIONS.filter((p) => p !== 'manage_api_tokens');
