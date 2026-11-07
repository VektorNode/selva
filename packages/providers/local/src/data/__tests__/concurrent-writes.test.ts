/**
 * Concurrent `tryIncrementSolveCount` on the local share-link store. Writers queue
 * on `withFileLock`, so within one process every increment lands; the capped case
 * is in `local-write-races.test.ts`.
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
 * bottoming out in `writeJsonFile`'s tmp+rename. POSIX renames atomically over
 * an open destination; Windows fails with EPERM when another handle (a sibling
 * writer, an antivirus scan of the fresh `.tmp`) is on the target — a platform
 * artifact unrelated to what these tests assert (see `fsJson.test.ts`). CI is
 * ubuntu-latest, so they still gate there. The sequential case stays live
 * everywhere — it's the contract that holds on both platforms.
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
		// Pins the fixed bug: with a shared `.tmp`, 19 of these 20 rejected with
		// ENOENT — a share link solved by several people at once surfaced as
		// random 500s instead of cap enforcement.
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

		// Whatever the count settled on, the document still parses and the link is intact.
		const after = await store.getById(SYSTEM_CONTEXT, l.id);
		expect(after).not.toBeNull();
		expect(after!.id).toBe(l.id);
		expect(after!.solveCount).toBeGreaterThan(0);
	});

	posixRename('counts every concurrent increment, each with its own number', async () => {
		const store = newStore();
		const l = link({ maxSolves: null });
		await store.create(SYSTEM_CONTEXT, l);

		const N = 20;
		const results = await Promise.all(
			Array.from({ length: N }, () => store.tryIncrementSolveCount(SYSTEM_CONTEXT, l.id))
		);

		expect([...results].sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(
			Array.from({ length: N }, (_, i) => i + 1)
		);
		expect((await store.getById(SYSTEM_CONTEXT, l.id))!.solveCount).toBe(N);
	});

	it('sequential increments are exact and stop at the cap', async () => {
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
