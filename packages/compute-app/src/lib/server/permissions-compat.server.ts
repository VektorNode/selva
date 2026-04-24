/**
 * §1g-core compat layer.
 *
 * The admin UI still treats platform + org permissions as one flat list
 * ({ permissions: ['instance_admin', 'manage_instance_users', ...] }). §1g-ui will
 * split the UI into a Platform Admins view and a per-org Members view; until
 * then, this helper bridges the flat list to the new two-scope model so the
 * current admin/users page keeps working end-to-end.
 */

import type { OrgPermission, PlatformPermission } from '@selva/platform';
import {
	ALL_ORG_PERMISSIONS,
	ALL_PLATFORM_PERMISSIONS
} from '@selva/platform';

const PLATFORM_SET: ReadonlySet<string> = new Set(ALL_PLATFORM_PERMISSIONS);
const ORG_SET: ReadonlySet<string> = new Set(ALL_ORG_PERMISSIONS);

export interface SplitPermissions {
	platform: PlatformPermission[];
	org: OrgPermission[];
}

/** Split a flat array into platform + org scope buckets, dropping unknowns. */
export function splitFlatPermissions(flat: readonly string[]): SplitPermissions {
	const platform: PlatformPermission[] = [];
	const org: OrgPermission[] = [];
	for (const p of flat) {
		if (PLATFORM_SET.has(p)) platform.push(p as PlatformPermission);
		else if (ORG_SET.has(p)) org.push(p as OrgPermission);
	}
	return { platform, org };
}

/** Merge platform + org perms into one flat array (for UI rendering). */
export function flattenPermissions(
	platform: readonly PlatformPermission[],
	org: readonly OrgPermission[]
): Array<PlatformPermission | OrgPermission> {
	return [...platform, ...org];
}
