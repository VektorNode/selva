import type { RequestContext } from '../context.js';

/**
 * Audit-field stamping helpers. Per Permissions.md §9, every mutable entity
 * carries `createdAt` / `createdBy` / `updatedAt` / `updatedBy` / `deletedAt`.
 *
 * `createdAt` / `createdBy` are stamped by the consumer when constructing the
 * record (these are not derivable from `ctx` alone — the caller knows whether
 * a record is being created from a user action vs. a system bootstrap).
 *
 * `updatedAt` / `updatedBy` and `deletedAt` are stamped by stores on every
 * mutation. The fallback actor exists because some operations run with a
 * system context where `ctx.userId` is empty — the prior `updatedBy` (or the
 * record's `ownerId` / `createdBy`) is used instead.
 */

const nowIso = (): string => new Date().toISOString();

export interface AuditUpdate {
	updatedAt: string;
	updatedBy: string;
}

/**
 * Fields to set when mutating an existing record.
 *
 * `fallbackActor` is used when `ctx.userId` is empty (system contexts). Pass
 * the record's prior `updatedBy`, or its `ownerId` / `createdBy` if `updatedBy`
 * is unset.
 */
export function auditUpdate(
	ctx: RequestContext,
	fallbackActor: string | null | undefined
): AuditUpdate {
	return {
		updatedAt: nowIso(),
		updatedBy: ctx.userId || fallbackActor || ''
	};
}

export interface AuditSoftDelete extends AuditUpdate {
	deletedAt: string;
}

/**
 * Fields to set when soft-deleting (or cascade-soft-deleting) a record.
 * Stamps `deletedAt` and the same `updatedAt` / `updatedBy` so the deletion
 * shows up in the standard mutation timeline.
 */
export function auditSoftDelete(
	ctx: RequestContext,
	fallbackActor: string | null | undefined
): AuditSoftDelete {
	const now = nowIso();
	return {
		deletedAt: now,
		updatedAt: now,
		updatedBy: ctx.userId || fallbackActor || ''
	};
}
