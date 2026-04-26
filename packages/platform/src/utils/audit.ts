import type { RequestContext } from '../context.js';

/**
 * Audit-field stamping helpers. Every mutable entity carries `createdAt` /
 * `createdBy` / `updatedAt` / `updatedBy` / `deletedAt`.
 *
 * `createdAt` / `createdBy` are stamped by the consumer when constructing
 * the record. `updatedAt` / `updatedBy` and `deletedAt` are stamped by
 * stores on every mutation.
 *
 * `fallbackActor` is used when `ctx.userId` is empty (system contexts) —
 * pass the record's prior `updatedBy` (or `ownerId` / `createdBy` if unset).
 */

const nowIso = (): string => new Date().toISOString();

export interface AuditUpdate {
	updatedAt: string;
	updatedBy: string;
}

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
