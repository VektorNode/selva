/**
 * Bridges the flat permission list the admin UI currently sends
 * (`{ permissions: ['instance_admin', 'manage_instance_users', ...] }`) to
 * the two-scope model adapters expect. Retire this when the UI splits into
 * scoped Platform-admin + Org-member views.
 */

import type { OrgPermission, PlatformPermission } from '@selva/platform';
import { ALL_ORG_PERMISSIONS, ALL_PLATFORM_PERMISSIONS } from '@selva/platform';

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
