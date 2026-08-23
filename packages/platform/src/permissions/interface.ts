import type { UserManagementResult } from '../auth/types.js';
import type { RequestContext } from '../context.js';
import type { PlatformPermission } from './types.js';

/**
 * Per-user platform permissions. Lives at the data layer (not on
 * `IAuthProvider`) so external IdPs don't need to model Selva-specific
 * authorization.
 *
 * **The sole-`instance_admin` invariant is enforced here**: any operation
 * that would leave zero users holding `instance_admin` must return
 * `'last_admin'`.
 *
 * Reads are scoped to "self or admin"; writes restricted to `instance_admin`.
 * Pass `SYSTEM_CONTEXT` for trusted server flows (bootstrap, hooks).
 */
export interface IPlatformPermissionStore {
	/** Empty array for users with no admin grants. Non-admin callers may only read self. */
	getFor(ctx: RequestContext, userId: string): Promise<PlatformPermission[]>;

	/** Admin-only. */
	getForBatch(
		ctx: RequestContext,
		userIds: readonly string[]
	): Promise<Map<string, PlatformPermission[]>>;

	/**
	 * Replace the user's permissions. Idempotent.
	 * `last_admin` — refused; would leave zero `instance_admin` users.
	 * `not_supported` is intentionally absent — every deployment must provide
	 * a permission store.
	 */
	set(
		ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<UserManagementResult>;

	/**
	 * True if at least one *enabled* user holds `instance_admin`. Adapters
	 * must exclude disabled users — over-count is safer than under-count.
	 */
	hasInstanceAdmin(ctx: RequestContext): Promise<boolean>;

	/**
	 * Count *other* users holding `instance_admin`. Callers check this
	 * before a destructive op — `count === 0` means the target is the last
	 * admin and the op must be refused. Must exclude disabled users.
	 */
	countInstanceAdminsExcluding(ctx: RequestContext, excludeUserId: string): Promise<number>;

	/**
	 * First-run bootstrap: grant `userId` every platform permission **only if
	 * the instance has no enabled `instance_admin` yet**. Returns whether this
	 * call was the one that claimed it.
	 *
	 * Exists because `hasInstanceAdmin()` followed by `set()` is a read-then-
	 * write: on a fresh single-tenant install with no
	 * `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` configured, any signer is eligible, so
	 * two people signing in at the same moment both observe "no admin" and both
	 * become permanent platform admins. §2 promises "first signer wins" — this
	 * is what makes that true rather than aspirational.
	 *
	 * Same shape as the sole-admin invariant (`set`), pointing the other way:
	 * that one refuses to drop the last admin, this one refuses to create a
	 * second first admin. Adapters MUST make the check and the write atomic.
	 */
	claimFirstInstanceAdmin(
		ctx: RequestContext,
		userId: string,
		permissions: readonly PlatformPermission[]
	): Promise<boolean>;
}
