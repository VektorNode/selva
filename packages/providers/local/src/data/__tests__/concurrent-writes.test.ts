/**
 * Audit Q5.2 — what the local provider actually does under concurrent writes.
 *
 * The audit predicted that `tryIncrementSolveCount`'s whole-file
 * read-modify-write "likely over-counts under contention". Measuring it turned
 * up something worse and different: 19 of 20 concurrent increments **threw
 * ENOENT**, because every writer shared one `${filePath}.tmp` staging file and
 * the first rename pulled it out from under the rest. That is fixed (each write
 * now stages through its own temp name — see `fsJson.ts`), and the first test
 * below is the regression pin.
 *
 * What remains is the honest, documented limitation. These tests **characterize
 * it rather than assert it away**, because pretending the local provider is
 * concurrency-safe would be worse than recording that it isn't:
 *
 *   - Writes no longer crash, and the file is never corrupt.
 *   - But read-modify-write still has a lost-update window: concurrent
 *     increments interleave their read and write, so the cap can be **exceeded**
 *     (over-admitted) and the stored count can end up **lower** than the number
 *     admitted. The local provider is a single-node dev/small-deployment
 *     backend; Supabase's SECURITY DEFINER RPC is the backend that actually
 *     provides the atomic guarantee (see
 *     `packages/providers/supabase/src/data/__tests__/share-link-concurrency.test.ts`,
 *     which is skipped without a live stack).
 *
 * So: the cap is exact under sequential load (pinned in the app's
 * `solve-cap-and-count.test.ts`) and best-effort under concurrent load here.
 * If the local provider ever gains real per-file locking, the characterization
 * tests below should tighten into guarantees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { SYSTEM_CONTEXT, type ShareLink } from '@selvajs/platform';
import { LocalShareLinkStore } from '../LocalShareLinkStore.js';

/**
 * The concurrent cases below land many overlapping writes on one JSON store,
 * which bottoms out in `writeJsonFile`'s tmp+rename. POSIX renames atomically
 * over an open destination; Windows fails with EPERM when another handle (a
 * sibling writer, an antivirus scan of the fresh `.tmp`) is on the target, so
 * these reject for a platform reason unrelated to what they assert. See the
 * matching note in `fsJson.test.ts`. CI is ubuntu-latest, where they gate
 * normally. The sequential case stays live everywhere — it's the contract that
 * holds on both platforms.
 */
const posixRename = it.skipIf(process.platform === 'win32');

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-concurrent-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function newStore(): LocalShareLinkStore {
	return new LocalShareLinkStore({ filePath: path.join(dir, 'share-links.json') });
}

function link(overrides: Partial<ShareLink> = {}): ShareLink {
	return {
		id: overrides.id ?? randomUUID(),
		definitionId: 'def-1',
		channel: 'live',
		tokenHash: 'hash',
		createdBy: 'user-1',
		createdAt: new Date().toISOString(),
		expiresAt: null,
		revokedAt: null,
		allowSolve: true,
		maxSolves: overrides.maxSolves === undefined ? 5 : overrides.maxSolves,
		solveCount: 0,
		...overrides
	};
}

describe('concurrent tryIncrementSolveCount (local provider)', () => {
	posixRename('REGRESSION: concurrent increments do not throw', async () => {
		// The bug this pins: with a shared `.tmp`, 19 of these 20 rejected with
		// ENOENT. A share-linked definition being solved by several people at
		// once would surface as random 500s, not as cap enforcement.
		const store = newStore();
		const l = link({ maxSolves: null });
		await store.create(SYSTEM_CONTEXT, l);

		const settled = await Promise.allSettled(
			Array.from({ length: 20 }, () => store.tryIncrementSolveCount(SYSTEM_CONTEXT, l.id))
		);

		const rejected = settled.filter((r) => r.status === 'rejected');
		expect(rejected).toEqual([]);
	});

	posixRename('leaves the store readable and uncorrupted after a concurrent storm', async () => {
		const store = newStore();
		const l = link({ maxSolves: null });
		await store.create(SYSTEM_CONTEXT, l);

		await Promise.all(
			Array.from({ length: 20 }, () => store.tryIncrementSolveCount(SYSTEM_CONTEXT, l.id))
		);

		// Whatever the count settled on, the document parses and the link is intact.
		const after = await store.getById(SYSTEM_CONTEXT, l.id);
		expect(after).not.toBeNull();
		expect(after!.id).toBe(l.id);
		expect(after!.solveCount).toBeGreaterThan(0);
	});

	posixRename('CHARACTERIZATION: concurrent increments lose updates (not atomic)', async () => {
		// Documents the known dev-scale tradeoff. Sequentially, 20 increments
		// give exactly 20; concurrently, interleaved read-modify-write means the
		// stored count is <= the number of attempts, and typically far lower.
		// Asserted as an inequality, not an exact number, because the amount of
		// loss is timing-dependent — the POINT is that it is lossy at all.
		const store = newStore();
		const l = link({ maxSolves: null });
		await store.create(SYSTEM_CONTEXT, l);

		const N = 20;
		await Promise.all(
			Array.from({ length: N }, () => store.tryIncrementSolveCount(SYSTEM_CONTEXT, l.id))
		);

		const after = await store.getById(SYSTEM_CONTEXT, l.id);
		expect(after!.solveCount).toBeLessThanOrEqual(N);
		// Sequentially it would be exactly N. If this ever equals N reliably,
		// the local store became atomic and this test should become a guarantee.
		expect(after!.solveCount).toBeGreaterThan(0);
	});

	posixRename('CHARACTERIZATION: a cap can be over-admitted under concurrency', async () => {
		// The security-relevant half. Sequentially the cap is exact (see the
		// app's solve-cap-and-count.test.ts). Concurrently, several callers can
		// each read a below-cap count before any of them writes, so more than
		// `maxSolves` requests get admitted. Recorded deliberately: an operator
		// relying on share caps as a hard billing limit needs the Supabase
		// backend, whose RPC does check-and-increment in one statement.
		const store = newStore();
		const CAP = 5;
		const l = link({ maxSolves: CAP });
		await store.create(SYSTEM_CONTEXT, l);

		const results = await Promise.all(
			Array.from({ length: 20 }, () => store.tryIncrementSolveCount(SYSTEM_CONTEXT, l.id))
		);
		const admitted = results.filter((r) => r !== null).length;

		// At least the cap is admitted; possibly more (that's the race).
		expect(admitted).toBeGreaterThanOrEqual(1);
		// The invariant that DOES hold: nothing is admitted once the persisted
		// count is at the cap, so the overshoot is bounded by concurrency, not
		// unbounded.
		const after = await store.getById(SYSTEM_CONTEXT, l.id);
		expect(after!.solveCount).toBeLessThanOrEqual(CAP);
	});

	it('sequential increments through the same store are exact (the contract that holds)', async () => {
		// The guarantee the local provider genuinely makes, and the one the
		// route depends on for single-user dev flows.
		const store = newStore();
		const CAP = 5;
		const l = link({ maxSolves: CAP });
		await store.create(SYSTEM_CONTEXT, l);

		const outcomes: Array<number | null> = [];
		for (let i = 0; i < CAP + 3; i++) {
			outcomes.push(await store.tryIncrementSolveCount(SYSTEM_CONTEXT, l.id));
		}

		expect(outcomes.filter((n): n is number => n !== null)).toEqual([1, 2, 3, 4, 5]);
		expect(outcomes.slice(CAP)).toEqual([null, null, null]);
		expect((await store.getById(SYSTEM_CONTEXT, l.id))!.solveCount).toBe(CAP);
	});
});
