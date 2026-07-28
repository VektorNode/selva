/**
 * Audit Q4/Q5 — compute-solve accounting: share-link solve caps and
 * definition solve-count increments.
 *
 * These are the **extraction safety net** for the embeddable-server-layer plan
 * (K3): the `/api/compute` POST handler enforces the share cap and bumps the
 * solve count by delegating to two store methods —
 * `shareLinks.tryIncrementSolveCount` (atomic check-and-increment, returns
 * `null` at the cap → the route maps that to HTTP 429) and
 * `definitions.incrementSolveCount`. They must keep behaving identically after
 * the solve pipeline is lifted out of the route, so these tests target the
 * exact methods the route calls, not the route's HTTP shell (which needs a live
 * compute server). Written against the store contract *before* K3 so they pass
 * unchanged across the pipeline/adapter split.
 *
 * The route call sites this pins:
 *   - share cap:  routes/api/compute/+server.ts (tryIncrementSolveCount → 429)
 *   - solve count: routes/api/compute/+server.ts (incrementSolveCount, best-effort)
 *
 * Scope: these run against the local provider (via `freshProviders`), so they
 * pin *sequential* semantics — the cap→null→429 mapping and loss-free counting.
 * The **concurrent** no-overshoot / no-lost-update guarantee is a store
 * atomicity property (Supabase's SECURITY DEFINER RPC + `increment_run_count`)
 * and is asserted in the Supabase share-link conformance suite, which is the
 * only backend that actually provides it. See
 * `packages/providers/supabase/src/data/__tests__/share-link-concurrency.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	seedShareLink,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('share-link solve cap enforcement', () => {
	it('an uncapped link (maxSolves = null) increments forever, never returns null', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: null
		});

		const results: Array<number | null> = [];
		for (let i = 0; i < 5; i++) {
			results.push(await tp.config.data.shareLinks.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id));
		}
		// Every solve is admitted; the count climbs monotonically.
		expect(results).toEqual([1, 2, 3, 4, 5]);
	});

	it('a capped link admits exactly maxSolves, then returns null (the route → 429)', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: 3
		});

		const store = tp.config.data.shareLinks;
		// First three solves are admitted...
		expect(await store.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id)).toBe(1);
		expect(await store.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id)).toBe(2);
		expect(await store.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id)).toBe(3);
		// ...the fourth is refused. `null` is exactly what the route turns into a
		// 429 "Share link solve cap reached." without wasting a compute call.
		expect(await store.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id)).toBeNull();
		// Still refused after the cap — no off-by-one that lets one extra through.
		expect(await store.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id)).toBeNull();
	});

	it('a revoked link is refused even below its cap (fail closed)', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: 10
		});
		await tp.config.data.shareLinks.revoke(SYSTEM_CONTEXT, link.id);

		expect(
			await tp.config.data.shareLinks.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id)
		).toBeNull();
	});

	it('sequential solves settle at exactly the cap (no off-by-one), and stay there', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const CAP = 5;
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: CAP
		});

		const store = tp.config.data.shareLinks;
		// Run CAP + 3 solves in sequence; exactly CAP are admitted (1..CAP), the
		// rest refused. Concurrent overshoot protection is a store-atomicity
		// property enforced by the Supabase SECURITY DEFINER RPC — asserted in the
		// Supabase conformance suite, not here (the local provider's whole-file
		// rewrite is a documented dev-scale tradeoff, not concurrency-safe).
		const outcomes: Array<number | null> = [];
		for (let i = 0; i < CAP + 3; i++) {
			outcomes.push(await store.tryIncrementSolveCount(SYSTEM_CONTEXT, link.id));
		}
		expect(outcomes.filter((n): n is number => n !== null)).toEqual([1, 2, 3, 4, 5]);
		expect(outcomes.slice(CAP)).toEqual([null, null, null]);

		const finalLink = await store.getById(SYSTEM_CONTEXT, link.id);
		expect(finalLink?.solveCount).toBe(CAP);
	});
});

describe('definition solve-count increments', () => {
	it('increments the definition run count by one per solve', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const before = await tp.config.data.definitions.get(SYSTEM_CONTEXT, def.record.guid);
		expect(before?.solveCount).toBe(0);

		await tp.config.data.definitions.incrementSolveCount(SYSTEM_CONTEXT, def.record.guid);
		await tp.config.data.definitions.incrementSolveCount(SYSTEM_CONTEXT, def.record.guid);

		const after = await tp.config.data.definitions.get(SYSTEM_CONTEXT, def.record.guid);
		expect(after?.solveCount).toBe(2);
	});

	it('sequential increments accumulate without loss', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		// The route bumps the count once per solve (best-effort — it catches and
		// logs failures rather than failing the solve). Loss-free accumulation
		// under true concurrency is a store-atomicity concern proven in the
		// Supabase conformance suite (the atomic `increment_run_count` RPC); the
		// local provider is sequential-only by design.
		const N = 15;
		for (let i = 0; i < N; i++) {
			await tp.config.data.definitions.incrementSolveCount(SYSTEM_CONTEXT, def.record.guid);
		}

		const after = await tp.config.data.definitions.get(SYSTEM_CONTEXT, def.record.guid);
		expect(after?.solveCount).toBe(N);
	});
});
