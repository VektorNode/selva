import type { RequestContext } from '../context.js';
import type { DomainEvent, DomainEventType } from './interface.js';

/**
 * Read-side counterpart to `IEventSink`. Persisted by the sink, queried by
 * operator-facing UIs (admin audit log) and future analytics consumers.
 *
 * Kept on its own interface so:
 *   - dev-mode `NoopEventSink` doesn't need a fake `query` returning empty;
 *     `auditQuery` simply stays undefined on `SelvaConfig`.
 *   - future webhook-dispatcher sinks aren't forced to implement a query path.
 *   - the contract here can throw on backend failure without violating the
 *     sink's "MUST NOT throw" rule.
 *
 * Authorisation is the caller's job — implementations read from a privileged
 * client (Supabase service-role, etc.) and assume the route layer has already
 * gated on `instance_admin`.
 */

export interface AuditEventRow {
	/** Stable row id from the persistent store (e.g. uuid). */
	id: string;
	/** ISO 8601. The persisted timestamp, not when the originating mutation occurred. */
	occurredAt: string;
	type: DomainEventType;
	actorId: string;
	/** The full `DomainEvent` payload as recorded. */
	data: DomainEvent;
}

/**
 * Keyset cursor. `(occurredAt, id)` lexicographic — `occurredAt` alone isn't
 * unique under bursty writes, so a tie-breaker is required to avoid skipped
 * rows on page boundaries.
 */
export interface AuditCursor {
	occurredAt: string;
	id: string;
}

export interface AuditQueryFilters {
	/** Restrict to these event types. Empty / undefined = all types. */
	types?: readonly DomainEventType[];
	/** Restrict to events emitted by this actor id (or `'system'`). */
	actorId?: string;
	/** Inclusive lower bound on `occurredAt`. ISO 8601. */
	sinceIso?: string;
	/** Inclusive upper bound on `occurredAt`. ISO 8601. */
	untilIso?: string;
	/**
	 * Page size. Implementations clamp to a sane upper bound (≤200) — callers
	 * shouldn't be able to request unbounded reads.
	 */
	limit?: number;
	/** Keyset cursor from a previous page's `nextCursor`. */
	cursor?: AuditCursor;
}

export interface AuditQueryResult {
	rows: AuditEventRow[];
	/** Null when there are no more rows past this page. */
	nextCursor: AuditCursor | null;
}

export interface IAuditQuery {
	list(ctx: RequestContext, filters: AuditQueryFilters): Promise<AuditQueryResult>;
}
