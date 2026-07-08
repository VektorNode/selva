import type { RequestContext } from '@selvajs/platform';
import { auditSoftDelete } from '@selvajs/platform';

/**
 * Row-level (snake_case) audit-stamp helpers for Supabase stores.
 *
 * Platform's `auditUpdate` / `auditSoftDelete` emit camelCase *domain* fields
 * (`updatedAt` / `updatedBy`), but Postgres rows are snake_case, so every store
 * hand-translated them. These helpers own that translation once. Row-column
 * naming is a provider concern, so they live here rather than in platform.
 *
 * Two deliberate rules, matched to how the engine's stores already write rows:
 *  - `updated_by` is written ONLY when `ctx.userId` is set. On system contexts
 *    it's the empty string, and the column FKs `auth.users(id)` with
 *    `ON DELETE SET NULL` — writing `''` would violate the FK, so it's omitted
 *    and the existing value is left untouched.
 *  - Plain updates DON'T stamp `updated_at`: a per-table `updated_at` trigger
 *    already sets it. Only the soft-delete stamp writes `updated_at` explicitly,
 *    so it matches `deleted_at` (a single timestamp for the deletion event).
 */

/**
 * Stamp for a plain UPDATE: `{ updated_by }` when the context carries a user,
 * `{}` otherwise (the DB trigger handles `updated_at`). Spread into the row:
 * `const row = { ...patch, ...stampUpdate(ctx) }`.
 */
export function stampUpdate(ctx: RequestContext): { updated_by?: string } {
	return ctx.userId ? { updated_by: ctx.userId } : {};
}

/**
 * Stamp for a soft-delete: `{ deleted_at, updated_at, updated_by? }`. `updated_at`
 * is set explicitly to equal `deleted_at`; `updated_by` follows the same
 * omit-when-empty rule as {@link stampUpdate}. `fallbackActor` defaults to
 * `ctx.userId` (matching the engine stores' `auditSoftDelete(ctx, ctx.userId)`).
 */
export function stampSoftDelete(
	ctx: RequestContext,
	fallbackActor: string | null | undefined = ctx.userId
): { deleted_at: string; updated_at: string; updated_by?: string } {
	const stamp = auditSoftDelete(ctx, fallbackActor);
	const row: { deleted_at: string; updated_at: string; updated_by?: string } = {
		deleted_at: stamp.deletedAt,
		updated_at: stamp.updatedAt
	};
	if (stamp.updatedBy) row.updated_by = stamp.updatedBy;
	return row;
}
