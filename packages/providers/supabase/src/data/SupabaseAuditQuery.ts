import type {
	AuditEventRow,
	AuditQueryFilters,
	AuditQueryResult,
	DomainEvent,
	IAuditQuery,
	RequestContext
} from '@selvajs/platform';
import type { ClientBundle } from './client.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

// Cursor values are interpolated into PostgREST filter strings — both formats
// must be validated before any string concatenation reaches the query.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Read-side for `audit_events`. Always uses the service-role client — RLS
 * blocks all read access by design, so the route layer is the single trust
 * boundary (callers must gate on `instance_admin`).
 *
 * Pagination is keyset on `(occurred_at desc, id desc)`. The `id` tie-breaker
 * prevents skipped rows when multiple events land in the same millisecond.
 */
export class SupabaseAuditQuery implements IAuditQuery {
	constructor(private readonly clients: ClientBundle) {}

	async list(_ctx: RequestContext, filters: AuditQueryFilters): Promise<AuditQueryResult> {
		const limit = clampLimit(filters.limit);

		let q = this.clients.serviceClient
			.from('audit_events')
			.select('id, type, actor_id, occurred_at, data')
			.order('occurred_at', { ascending: false })
			.order('id', { ascending: false })
			// Fetch one extra row to detect "has next page" without a count query.
			.limit(limit + 1);

		if (filters.types && filters.types.length > 0) {
			q = q.in('type', [...filters.types]);
		}
		if (filters.actorId) {
			q = q.eq('actor_id', filters.actorId);
		}
		if (filters.sinceIso) {
			q = q.gte('occurred_at', filters.sinceIso);
		}
		if (filters.untilIso) {
			q = q.lte('occurred_at', filters.untilIso);
		}
		if (filters.cursor) {
			// `(occurred_at, id) < (cursorTs, cursorId)` expressed for PostgREST:
			// strictly older OR same timestamp with a strictly smaller id.
			//
			// Both values are interpolated into a `.or()` filter string. Validate
			// shape before interpolation — without these guards a malformed cursor
			// (or a hand-crafted URL by a route caller) could break out of the
			// filter and combine with arbitrary PostgREST operators.
			const ts = filters.cursor.occurredAt;
			const id = filters.cursor.id;
			if (!ISO_RE.test(ts) || !UUID_RE.test(id)) {
				throw new Error('audit_events query: malformed cursor');
			}
			q = q.or(`occurred_at.lt.${ts},and(occurred_at.eq.${ts},id.lt.${id})`);
		}

		const { data, error } = await q;
		if (error) {
			throw new Error(`audit_events query failed: ${error.message}`);
		}

		const fetched = (data ?? []) as Array<{
			id: string;
			type: string;
			actor_id: string;
			occurred_at: string;
			data: DomainEvent;
		}>;

		const hasMore = fetched.length > limit;
		const page = hasMore ? fetched.slice(0, limit) : fetched;
		const last = page[page.length - 1];

		return {
			rows: page.map((r) => ({
				id: r.id,
				type: r.type as DomainEvent['type'],
				actorId: r.actor_id,
				occurredAt: r.occurred_at,
				data: r.data
			})) satisfies AuditEventRow[],
			nextCursor: hasMore && last ? { occurredAt: last.occurred_at, id: last.id } : null
		};
	}
}

function clampLimit(requested: number | undefined): number {
	if (!requested || requested <= 0) return DEFAULT_LIMIT;
	if (requested > MAX_LIMIT) return MAX_LIMIT;
	return Math.floor(requested);
}
