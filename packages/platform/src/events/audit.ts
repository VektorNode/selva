import type { RequestContext } from '../context.js';
import type { DomainEvent, DomainEventType } from './interface.js';

/**
 * Read-side counterpart to `IEventSink`, kept as its own interface: a
 * dev-mode `NoopEventSink` doesn't need a fake `query`, a future
 * webhook-dispatcher sink isn't forced to implement one, and this contract
 * can throw on backend failure without violating the sink's "MUST NOT throw"
 * rule.
 *
 * Authorisation is the caller's job — implementations read from a privileged
 * client (Supabase service-role, etc.) and assume the route layer already
 * gated on `instance_admin`.
 */

export interface AuditEventRow {
	id: string;
	/** ISO 8601. When the row was persisted, not when the mutation occurred. */
	occurredAt: string;
	type: DomainEventType;
	actorId: string;
	data: DomainEvent;
}

/**
 * `(occurredAt, id)` lexicographic — `occurredAt` alone isn't unique under
 * bursty writes, so the tie-breaker avoids skipping rows on page boundaries.
 */
export interface AuditCursor {
	occurredAt: string;
	id: string;
}

export interface AuditQueryFilters {
	/** Empty/undefined = all types. */
	types?: readonly DomainEventType[];
	actorId?: string;
	/** Inclusive bounds, ISO 8601. */
	sinceIso?: string;
	untilIso?: string;
	/** Implementations clamp to a sane upper bound (<=200). */
	limit?: number;
	cursor?: AuditCursor;
}

export interface AuditQueryResult {
	rows: AuditEventRow[];
	/** Null past the last page. */
	nextCursor: AuditCursor | null;
}

export interface IAuditQuery {
	list(ctx: RequestContext, filters: AuditQueryFilters): Promise<AuditQueryResult>;
}
