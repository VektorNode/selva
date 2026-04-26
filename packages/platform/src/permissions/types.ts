import { z } from 'zod';

/**
 * Platform-scope permissions. Reserved for Selva-staff and instance operators;
 * regular users hold an empty array.
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

export const ALL_PLATFORM_PERMISSIONS: readonly PlatformPermission[] =
	PlatformPermissionSchema.options;
