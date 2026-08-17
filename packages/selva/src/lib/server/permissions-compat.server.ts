/**
 * Bridges the flat `permissions` array the v1 invite body accepts to the
 * two-scope model adapters expect. One invite legitimately carries both scopes,
 * so this outlives the admin/team UI split; retire it when the invite body
 * grows separate `platformPermissions` + `orgPermissions` fields.
 */

import type { OrgPermission, PlatformPermission } from '@selvajs/platform';
import { ALL_ORG_PERMISSIONS, ALL_PLATFORM_PERMISSIONS } from '@selvajs/platform';

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
