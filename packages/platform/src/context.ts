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
 */
export interface RequestContext {
	/** Stable user id from the auth provider. */
	userId: string;
	/** Active organization scope. Undefined for platform-admin global reads. */
	orgId?: string;
	/** Platform-level permissions for this user. */
	permissions: Permission[];
}

/**
 * Context for server-internal operations that run outside any HTTP request:
 * bootstrap, scheduled janitors, migrations, tests.
 *
 * Adapters should treat this as fully authorized — callers are trusted server
 * code, not users. Never derive this from a user session.
 */
export const SYSTEM_CONTEXT: RequestContext = {
	userId: '__system__',
	permissions: [...ALL_PERMISSIONS]
};
