import type { UserManagementResult } from '../auth/types.js';
import type { RequestContext } from '../context.js';
import type { PlatformPermission } from './types.js';

/**
 * Per-user platform permissions. Lives at the data layer (not on
 * `IAuthProvider`) so external IdPs don't need to model Selva-specific
 * authorization.
 *
 * **The sole-`instance_admin` invariant is enforced here.** Any operation
 * that would leave zero users holding `instance_admin` MUST return
 * `'last_admin'`. Auth providers consult `countInstanceAdminsExcluding`
 * before any destructive op so the invariant holds across edits, deletes,
 * and disables.
 *
 * Reads are scoped to "self or admin"; writes restricted to `instance_admin`.
 * Pass `SYSTEM_CONTEXT` for trusted server flows (bootstrap, hooks).
 */
export interface IPlatformPermissionStore {
	/**
	 * Read permissions for a single user. Empty array for users with no
	 * admin grants (the common case). Non-admin callers may only read self.
	 */
	getFor(ctx: RequestContext, userId: string): Promise<PlatformPermission[]>;

	/** Batch-read for the admin user list. Admin-only. */
	getForBatch(
		ctx: RequestContext,
		userIds: readonly string[]
	): Promise<Map<string, PlatformPermission[]>>;

	/**
	 * Replace the user's permissions. Idempotent. Returns:
	 * - `ok` — succeeded
	 * - `not_found` — target user doesn't exist
	 * - `last_admin` — refused; would leave zero `instance_admin` users
	 *
	 * `not_supported` is intentionally absent — every deployment must provide
	 * a permission store.
	 */
	set(
		ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<UserManagementResult>;

	/**
	 * True if at least one *enabled* user holds `instance_admin`. Used by
	 * first-run detection and the destructive-op invariant check. Adapters
	 * MUST exclude disabled users (over-count is safer than under-count).
	 */
	hasInstanceAdmin(ctx: RequestContext): Promise<boolean>;

	/**
	 * Count *other* users holding `instance_admin`. `deleteUser` / `disableUser`
	 * call this BEFORE the destructive op — `count === 0` ⇒ `'last_admin'`.
	 * MUST exclude disabled users.
	 */
	countInstanceAdminsExcluding(
		ctx: RequestContext,
		excludeUserId: string
	): Promise<number>;
}
