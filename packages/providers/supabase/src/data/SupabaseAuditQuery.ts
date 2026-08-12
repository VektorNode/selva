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

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Read-side for `audit_events`. Always uses the service-role client — RLS
 * blocks all reads by design, so the route layer is the sole trust boundary
 * and must gate callers on `instance_admin`.
 *
 * Pagination is keyset on `(occurred_at desc, id desc)`; the `id` tie-breaker
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
			.limit(limit + 1); // one extra row to detect "has more" without a count query

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
			// Expresses `(occurred_at, id) < (cursorTs, cursorId)` as a PostgREST
			// `.or()` string: strictly older, or same timestamp with a smaller id.
			// Both values get interpolated into that string, so a malformed cursor
			// could inject arbitrary PostgREST operators — validate shape first.
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
