/**
 * Adapter conformance suite for IAuditQuery, read through the sink that writes the
 * rows. Also holds an IEventSink to what the query shows: per-actor order.
 */

import { describe, it, expect } from 'vitest';
import { makeSystemCtx, makeUuid } from './helpers.js';
import type { AuditCursor, IAuditQuery } from '../../events/audit.js';
import type { DomainEvent, IEventSink } from '../../events/interface.js';

export interface AuditQueryConformanceOptions {
	name: string;
	/** A query and the sink that feeds it, over storage that starts empty. */
	createStores: () =>
		Promise<{ query: IAuditQuery; sink: IEventSink }> | { query: IAuditQuery; sink: IEventSink };
}

const ctx = makeSystemCtx();

const deleted = (orgId: string, actorId: string): DomainEvent => ({
	type: 'org.deleted',
	orgId,
	actorId
});
const created = (orgId: string, actorId: string): DomainEvent => ({
	type: 'org.created',
	orgId,
	actorId
});

export function runAuditQueryConformance(opts: AuditQueryConformanceOptions): void {
	const { name, createStores } = opts;

	describe(`IAuditQuery conformance: ${name}`, () => {
		it("returns one actor's events newest first, in the order they were emitted", async () => {
			const { query, sink } = await createStores();
			const actor = makeUuid();
			const orgs = [makeUuid(), makeUuid(), makeUuid()];
			for (const org of orgs) await sink.emit(deleted(org, actor));

			const { rows } = await query.list(ctx, { actorId: actor });

			expect(rows.map((r) => (r.data as { orgId: string }).orgId)).toEqual([...orgs].reverse());
		});

		it('filters by type and actor', async () => {
			const { query, sink } = await createStores();
			const actor = makeUuid();
			await sink.emit(created(makeUuid(), actor));
			await sink.emit(deleted(makeUuid(), actor));
			await sink.emit(deleted(makeUuid(), makeUuid()));

			const { rows } = await query.list(ctx, { actorId: actor, types: ['org.deleted'] });

			expect(rows.map((r) => r.type)).toEqual(['org.deleted']);
		});

		it('honours the time bounds', async () => {
			const { query, sink } = await createStores();
			const actor = makeUuid();
			await sink.emit(deleted(makeUuid(), actor));

			const future = new Date(Date.now() + 60_000).toISOString();
			const past = new Date(Date.now() - 60_000).toISOString();

			expect((await query.list(ctx, { actorId: actor, sinceIso: future })).rows).toEqual([]);
			expect((await query.list(ctx, { actorId: actor, untilIso: past })).rows).toEqual([]);
		});

		it('pages through every row exactly once', async () => {
			const { query, sink } = await createStores();
			const actor = makeUuid();
			for (let i = 0; i < 5; i++) await sink.emit(deleted(makeUuid(), actor));

			const seen: string[] = [];
			let cursor: AuditCursor | undefined;
			for (;;) {
				const page = await query.list(ctx, { actorId: actor, limit: 2, cursor });
				seen.push(...page.rows.map((r) => r.id));
				if (!page.nextCursor) break;
				cursor = page.nextCursor;
			}

			expect(seen).toHaveLength(5);
			expect(new Set(seen).size).toBe(5);
		});

		it('still returns a row for a fractional limit', async () => {
			const { query, sink } = await createStores();
			const actor = makeUuid();
			await sink.emit(deleted(makeUuid(), actor));

			const { rows } = await query.list(ctx, { actorId: actor, limit: 0.5 });

			expect(rows).toHaveLength(1);
		});
	});
}
