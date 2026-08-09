import type { RequestContext } from '@selvajs/platform';
import { auditSoftDelete } from '@selvajs/platform';

/**
 * Translates platform's camelCase audit fields (`updatedAt`/`updatedBy`) to
 * the snake_case columns every Supabase row uses.
 *
 * `updated_by` is written only when `ctx.userId` is set. On system contexts
 * `auditUpdate`/`auditSoftDelete` fall back to `''`, and the column FKs
 * `auth.users(id)` — writing `''` violates the FK — so it's omitted instead,
 * leaving the existing value untouched.
 *
 * Plain updates don't stamp `updated_at`: a per-table trigger already sets
 * it. Only soft-delete sets `updated_at` explicitly, to match `deleted_at`.
 */

export function stampUpdate(ctx: RequestContext): { updated_by?: string } {
	return ctx.userId ? { updated_by: ctx.userId } : {};
}

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
