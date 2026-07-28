/**
 * Audit Q4/Q5 — the concurrent-solve guarantee for share-link caps.
 *
 * `tryIncrementSolveCount` is the load-bearing race-sensitive method: the
 * `/api/compute` endpoint calls it BEFORE solving and turns a `null` return
 * (cap hit) into HTTP 429. Under concurrent solves against one capped link, the
 * cap must hold exactly — no overshoot, no lost update handing two solves the
 * same slot. Supabase provides this via the SECURITY DEFINER
 * `try_increment_share_link_solve_count` RPC, which does the check-and-increment
 * in a single statement.
 *
 * This lives in the Supabase suite (not the shared conformance suite or the app
 * route tests) because it is the ONLY backend that actually provides the
 * guarantee: the local provider's whole-file read-modify-write is a documented
 * dev-scale tradeoff and is not concurrency-safe. Skipped without a live stack,
 * matching the other conformance tests here.
 *
 * Complements the sequential cap/count tests at
 * `packages/selva/src/routes/api/compute/__tests__/solve-cap-and-count.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestContext, ShareLink } from '@selvajs/platform';
import { SupabaseShareLinkStore } from '../SupabaseShareLinkStore.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseShareLinkStore concurrency (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	const ctx: RequestContext = { userId: '', system: true } as RequestContext;

	/** Seed org → project → definition → share link, all via service-role. */
	async function seedCappedLink(maxSolves: number): Promise<{ linkId: string }> {
		const { userId: ownerId } = await seedUser(envCtx!, '');
		const admin = envCtx!.adminClient;
		const orgId = crypto.randomUUID();
		const projectId = crypto.randomUUID();
		const definitionId = crypto.randomUUID();
		const linkId = crypto.randomUUID();
		const now = new Date().toISOString();

		const { error: orgErr } = await admin.from('orgs').insert({
			id: orgId,
			name: 'Concurrency Org',
			slug: `conc-${orgId.slice(0, 8)}`,
			owner_id: ownerId,
			created_at: now,
			updated_at: now
		});
		if (orgErr) throw orgErr;
		const { error: projErr } = await admin.from('projects').insert({
			id: projectId,
			org_id: orgId,
			name: 'Project',
			slug: `proj-${projectId.slice(0, 8)}`,
			visibility: 'public',
			owner_id: ownerId,
			created_at: now,
			updated_at: now
		});
		if (projErr) throw projErr;
		const { error: defErr } = await admin.from('definitions').insert({
			guid: definitionId,
			project_id: projectId,
			owner_id: ownerId,
			display_name: 'Def',
			status: 'published',
			created_at: now,
			updated_at: now
		});
		if (defErr) throw defErr;

		const link: ShareLink = {
			id: linkId,
			definitionId,
			channel: 'live',
			tokenHash: crypto.randomUUID().replace(/-/g, ''),
			createdBy: ownerId,
			createdAt: now,
			expiresAt: null,
			revokedAt: null,
			allowSolve: true,
			maxSolves,
			solveCount: 0
		};
		const store = new SupabaseShareLinkStore(envCtx!.bundle);
		await store.create(ctx, link);
		return { linkId };
	}

	describe('SupabaseShareLinkStore — concurrent solve-cap enforcement', () => {
		beforeEach(async () => {
			await resetAllData(envCtx!);
		});

		it('N concurrent solves against a cap-K link admit exactly K, refuse the rest', async () => {
			const CAP = 5;
			const ATTEMPTS = 25;
			const { linkId } = await seedCappedLink(CAP);
			const store = new SupabaseShareLinkStore(envCtx!.bundle);

			const outcomes = await Promise.all(
				Array.from({ length: ATTEMPTS }, () => store.tryIncrementSolveCount(ctx, linkId))
			);

			const admitted = outcomes.filter((n): n is number => n !== null);
			const refused = outcomes.filter((n) => n === null);
			// Exactly CAP admitted — the atomic RPC never lets a concurrent burst
			// overshoot the cap.
			expect(admitted).toHaveLength(CAP);
			expect(refused).toHaveLength(ATTEMPTS - CAP);
			// Each admitted solve got a distinct slot 1..CAP — no lost update.
			expect([...admitted].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

			// The persisted count settles at exactly the cap.
			const finalLink = await store.getById(ctx, linkId);
			expect(finalLink?.solveCount).toBe(CAP);
		});
	});
}
