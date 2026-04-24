import type { Permission } from './auth/types.js';
import { ALL_PERMISSIONS } from './auth/types.js';

/**
 * Per-request identity + scope passed as the first argument to every data
 * provider call. Built once per HTTP request (hooks.server.ts) from the
 * authenticated session.
 *
 * Adapters MUST use this to scope queries to the caller's tenant/org.
 * Adding a new dimension (tenantId, impersonatedBy, etc.) goes here — not
 * as a new parameter on every method.
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
	/** Active organization scope. Undefined for platform-admin global reads. */
	orgId?: string;
	/** Platform-level permissions for this user. */
	permissions: Permission[];
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
	permissions: [...ALL_PERMISSIONS],
	system: true
};
