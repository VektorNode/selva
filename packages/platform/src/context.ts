import type { PlatformPermission } from './auth/types.js';
import { ALL_PLATFORM_PERMISSIONS } from './auth/types.js';
import type { OrgPermission } from './organizations/schemas.js';
import { ALL_ORG_PERMISSIONS } from './organizations/schemas.js';

/**
 * Per-request identity + scope passed as the first argument to every data
 * provider call. Built once per HTTP request (hooks.server.ts) from the
 * authenticated session + the active organization (resolved from URL prefix,
 * subdomain, header, or user default).
 *
 * Adapters MUST use this to scope queries to the caller's tenant/org.
 * Adding a new dimension (tenantId, impersonatedBy, etc.) goes here — not
 * as a new parameter on every method.
 *
 * ## Permission model
 *
 * Permissions live at two scopes:
 * - `platformPermissions` — span every org on the instance. Rare role;
 *   typically empty. Only `platform_admin` exists here today.
 * - `orgPermissions` — fine-grained rights within the **active** org
 *   (`orgId`). Empty when `orgId` is undefined. These are resolved from
 *   the user's `OrgMember.permissions` row for the active org.
 *
 * A `platform_admin` implicitly holds every `OrgPermission` in every org;
 * the `hasPermission` helper encodes that.
 *
 * ## System context
 *
 * `system: true` marks a trusted server-internal call (bootstrap, janitor,
 * elevated read). Adapters that enforce per-user scoping (e.g. Supabase RLS)
 * MUST grant full access when this flag is set; the discriminant is the
 * single source of truth for "bypass tenant scoping," replacing the previous
 * magic `userId === '__system__'` check.
 */
export interface RequestContext {
	/** Stable user id from the auth provider. Empty string for system contexts. */
	userId: string;
	/** Active organization scope. Undefined for platform-admin global reads / pre-org routes. */
	orgId?: string;
	/** Platform-scope permissions (e.g. `platform_admin`). Typically empty. */
	platformPermissions: PlatformPermission[];
	/** Org-scope permissions for the active org. Empty when `orgId` is undefined. */
	orgPermissions: OrgPermission[];
	/**
	 * When true, this is a trusted server-internal call (not a user request).
	 * Adapters with row-level security MUST treat this as fully authorized.
	 * Never set this from data derived from a user session.
	 */
	system?: true;
	/**
	 * Adapter-specific session payload. Opaque to the platform contract —
	 * each adapter narrows it at its boundary. Used by adapters that need
	 * the upstream auth token to build an authenticated client (e.g. the
	 * Supabase adapter passes the user JWT here so RLS policies can resolve
	 * `auth.uid()`). Adapters that don't need it ignore the field.
	 */
	adapterContext?: unknown;
}

/**
 * Context for server-internal operations that run outside any HTTP request:
 * bootstrap, scheduled janitors, migrations, tests, elevated reads from
 * authenticated routes that need to span tenants.
 *
 * Adapters should treat this as fully authorized — callers are trusted server
 * code, not users. Never derive this from a user session.
 */
export const SYSTEM_CONTEXT: RequestContext = {
	userId: '',
	platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
	orgPermissions: [...ALL_ORG_PERMISSIONS],
	system: true
};

/**
 * Returns true if the caller holds the given permission, resolving
 * platform-vs-org scope automatically:
 * - `platform_admin` is checked against `ctx.platformPermissions`.
 * - Any `OrgPermission` is satisfied either by holding `platform_admin`
 *   (which implicitly grants every org permission everywhere) or by having
 *   it in `ctx.orgPermissions` for the currently active org.
 *
 * Does NOT cross-check `ctx.orgId`: the caller is responsible for building
 * a context scoped to the org they're acting on. Passing an org permission
 * against a `ctx` without `orgId` returns false unless the caller is
 * `platform_admin` or `system`.
 */
export function hasPermission(
	ctx: RequestContext,
	permission: PlatformPermission | OrgPermission
): boolean {
	if (ctx.system) return true;
	if (ctx.platformPermissions.includes('platform_admin')) return true;
	if (permission === 'platform_admin') return false;
	return ctx.orgPermissions.includes(permission);
}
