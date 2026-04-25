import type { PlatformPermission, UserManagementResult } from '../auth/types.js';
import type { RequestContext } from '../context.js';

/**
 * Data-layer store for per-user platform permissions.
 *
 * **Why this is separate from `IAuthProvider`.** Identity (who you are) belongs
 * to the auth backend. Authorization (what you can do *here*) belongs to
 * Selva. External IdPs (OIDC, SAML, hosted auth) can't store Selva-specific
 * permissions; the data layer can. Selva-staff/instance operators are still
 * managed via this store regardless of which auth provider issues the user.
 *
 * **The §2 sole-`instance_admin` invariant lives here** (Permissions.md §10).
 * Any operation that would leave zero users holding `instance_admin` MUST
 * return `'last_admin'`. The auth provider's `deleteUser` / `disableUser` ask
 * `countInstanceAdminsExcluding(userId)` before performing the destructive
 * op so the invariant holds across permission edits, deletes, and disables.
 *
 * **Auth boundary.** Reads scoped to "self or admin"; writes restricted to
 * `instance_admin`. Adapters enforce in `set` / `getFor`. Pass `SYSTEM_CONTEXT`
 * for trusted server-side flows (hooks `buildContext`, setup bootstrap).
 */
export interface IPlatformPermissionStore {
	/**
	 * Read the platform permissions for a single user. Returns an empty array
	 * for users with no admin grants (the common case). Adapters MUST scope by
	 * `ctx`: a non-admin caller may only read their own permissions.
	 */
	getFor(ctx: RequestContext, userId: string): Promise<PlatformPermission[]>;

	/**
	 * Batch-read for the admin user list. Returns a map keyed by `userId`;
	 * users with no row resolve to an empty array on the consumer side.
	 * Admin-only — adapters enforce.
	 */
	getForBatch(
		ctx: RequestContext,
		userIds: readonly string[]
	): Promise<Map<string, PlatformPermission[]>>;

	/**
	 * Replace the user's platform permissions. Returns:
	 *
	 * - `'ok'` — succeeded
	 * - `'not_found'` — target user doesn't exist (in the underlying store)
	 * - `'last_admin'` — refused; would leave zero `instance_admin` users
	 *
	 * Idempotent: setting the same array twice is a no-op (and never reports
	 * `'last_admin'` unless the second call would actually drop the count).
	 *
	 * `'not_supported'` is intentionally absent — every Selva deployment must
	 * provide a permission store. Auth providers are pluggable; permissions
	 * are not.
	 */
	set(
		ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<UserManagementResult>;

	/**
	 * Returns true if at least one *enabled* user holds `instance_admin`.
	 * Used by:
	 *   - first-run detection in `hooks.server.ts` (replaces the
	 *     `auth.listUsers().length === 0` heuristic, which doesn't work for
	 *     OIDC providers that can't enumerate users)
	 *   - the auth provider's `deleteUser` / `disableUser` invariant check
	 *     (in conjunction with `countInstanceAdminsExcluding`)
	 *
	 * "Enabled" means the user is not disabled in the auth backend; adapters
	 * may need to cross-reference auth-side state. The `auth` parameter (when
	 * provided) lets the store consult the auth backend for disabled-status;
	 * if omitted the store may approximate (better to over-count than to
	 * accidentally allow zero admins).
	 */
	hasInstanceAdmin(ctx: RequestContext): Promise<boolean>;

	/**
	 * Count *other* users (not `excludeUserId`) currently holding
	 * `instance_admin`. The `deleteUser` / `disableUser` flows call this
	 * BEFORE the destructive op:
	 *   - `count === 0` → return `'last_admin'`
	 *   - `count >= 1`  → proceed
	 *
	 * Like `hasInstanceAdmin`, MUST exclude disabled users to match §10's
	 * "enabled instance_admin" semantics.
	 */
	countInstanceAdminsExcluding(
		ctx: RequestContext,
		excludeUserId: string
	): Promise<number>;
}
