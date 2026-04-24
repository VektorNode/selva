import type { PlatformPermission } from './auth/types.js';
import { ALL_PLATFORM_PERMISSIONS } from './auth/types.js';
import type { OrgPermission } from './organizations/schemas.js';
import { ALL_ORG_PERMISSIONS } from './organizations/schemas.js';

/**
 * Per-request identity + scope passed as the first argument to every data
 * provider call. Built once per HTTP request in hooks.server.ts.
 *
 * `actingOrgId` is the org the user is currently acting as — NOT "an org the
 * user is a member of." Tenancy checks compare `ctx.actingOrgId` to the
 * resource's `orgId`; anything else can leak across orgs when a user belongs
 * to multiple.
 *
 * `instance_admin` implies every other permission, everywhere. `hasPermission`
 * encodes that. A `system: true` ctx is a trusted server-internal call
 * (bootstrap, janitors) — adapters with RLS must treat it as fully authorized.
 */
export interface RequestContext {
	/** Empty string for system contexts. */
	userId: string;
	/** Undefined for instance-admin global reads and pre-org routes. */
	actingOrgId?: string;
	platformPermissions: PlatformPermission[];
	/** Empty when `actingOrgId` is undefined. */
	orgPermissions: OrgPermission[];
	/** Never derive from a user session. */
	system?: true;
	/**
	 * Opaque adapter payload. The Supabase adapter uses this to pass the user
	 * JWT through so RLS policies can resolve `auth.uid()`; local ignores it.
	 */
	adapterContext?: unknown;
}

/**
 * For server-internal operations outside any HTTP request (bootstrap,
 * janitors, migrations, cross-tenant elevated reads). Treated as fully
 * authorized; never derive from a user session.
 */
export const SYSTEM_CONTEXT: RequestContext = {
	userId: '',
	platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
	orgPermissions: [...ALL_ORG_PERMISSIONS],
	system: true
};

/**
 * Does NOT cross-check `ctx.actingOrgId`: the caller builds a context scoped
 * to the org they're acting on. An org permission against a ctx without
 * `actingOrgId` returns false unless `instance_admin` or `system`.
 */
export function hasPermission(
	ctx: RequestContext,
	permission: PlatformPermission | OrgPermission
): boolean {
	if (ctx.system) return true;
	if (ctx.platformPermissions.includes('instance_admin')) return true;
	if (isPlatformPermission(permission)) {
		return ctx.platformPermissions.includes(permission);
	}
	return ctx.orgPermissions.includes(permission);
}

const PLATFORM_PERMISSION_VALUES = new Set<string>(ALL_PLATFORM_PERMISSIONS);

function isPlatformPermission(p: string): p is PlatformPermission {
	return PLATFORM_PERMISSION_VALUES.has(p);
}
