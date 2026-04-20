/**
 * Adapter conformance suite for IDefinitionStore.
 *
 * The goal is to prove every adapter behaves identically from the consuming
 * app's perspective — `ctx` scoping, `pending` filtering, `listStalePending`
 * cutoff, history mutations, and error shapes.
 *
 * Runner-agnostic: callers inject a `{ describe, it, expect }` trio so this
 * package stays test-framework free. For vitest or jest, pass the globals
 * directly; for node:test, wrap them.
 */

import type { IDefinitionStore } from '../../data/interface.js';
import type { DefinitionRecord, HistoryEntry } from '../../definitions/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { type ConformanceRunner, makeCtx, makeUuid } from './runner.js';

export type { ConformanceRunner };

export interface DefinitionStoreConformanceOptions {
	/** Name to show in the test output (e.g. "local-provider"). */
	name: string;
	/** Factory that returns a fresh, empty store per test. */
	createStore: () => Promise<IDefinitionStore> | IDefinitionStore;
	/** Test runner globals injected from the host package. */
	runner: ConformanceRunner;
	/**
	 * Set to true for adapters that enforce per-user ctx scoping (e.g. Supabase RLS).
	 * When false, ctx-isolation tests are skipped (local JSON adapter shares all records).
	 */
	ctxIsolation?: boolean;
}

const ctx = makeCtx;

function record(overrides: Partial<DefinitionRecord> = {}): DefinitionRecord {
	const now = new Date().toISOString();
	return {
		guid: overrides.guid ?? makeUuid(),
		projectId: overrides.projectId ?? 'project-1',
		ownerId: overrides.ownerId ?? 'user-1',
		fileExt: overrides.fileExt ?? 'gh',
		meta: overrides.meta ?? { displayName: 'Test' },
		history: overrides.history ?? [],
		maxHistory: overrides.maxHistory ?? 10,
		status: overrides.status ?? 'ready',
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		...overrides
	};
}

export function runDefinitionStoreConformance(opts: DefinitionStoreConformanceOptions): void {
	const { name, createStore, runner, ctxIsolation = false } = opts;
	const { describe, it, expect } = runner;

	describe(`IDefinitionStore conformance: ${name}`, () => {
		it('create + get returns the record', async () => {
			const store = await createStore();
			const rec = record({ guid: 'g1' });
			await store.create(ctx('u1'), rec);
			const got = await store.get(ctx('u1'), 'g1');
			expect(got?.guid).toBe('g1');
		});

		it('get returns null for missing guid', async () => {
			const store = await createStore();
			const got = await store.get(ctx('u1'), 'does-not-exist');
			expect(got).toBeNull();
		});

		it('list filters pending by default', async () => {
			const store = await createStore();
			await store.create(ctx('u1'), record({ guid: 'r1', status: 'ready' }));
			await store.create(ctx('u1'), record({ guid: 'p1', status: 'pending' }));

			const page = await store.list(ctx('u1'));
			const guids = page.items.map((r) => r.guid);
			expect(guids).toContain('r1');
			expect(guids).not.toContain('p1');
		});

		it('list with includePending returns pending too', async () => {
			const store = await createStore();
			await store.create(ctx('u1'), record({ guid: 'r1', status: 'ready' }));
			await store.create(ctx('u1'), record({ guid: 'p1', status: 'pending' }));

			const page = await store.list(ctx('u1'), { includePending: true });
			const guids = page.items.map((r) => r.guid);
			expect(guids).toContain('r1');
			expect(guids).toContain('p1');
		});

		it('listByProject filters by projectId', async () => {
			const store = await createStore();
			await store.create(ctx('u1'), record({ guid: 'a', projectId: 'proj-a' }));
			await store.create(ctx('u1'), record({ guid: 'b', projectId: 'proj-b' }));

			const page = await store.listByProject(ctx('u1'), 'proj-a');
			const guids = page.items.map((r) => r.guid);
			expect(guids).toEqual(['a']);
		});

		it('update applies patch and bumps updatedAt', async () => {
			const store = await createStore();
			const created = record({ guid: 'u1', meta: { displayName: 'Old' } });
			await store.create(ctx('u1'), created);

			await store.update(ctx('u1'), 'u1', { meta: { displayName: 'New' } });
			const got = await store.get(ctx('u1'), 'u1');
			expect(got?.meta.displayName).toBe('New');
			expect(got!.updatedAt >= created.updatedAt).toBe(true);
		});

		it('update on missing guid throws ProviderError with status 404', async () => {
			const store = await createStore();
			let thrown: unknown;
			try {
				await store.update(ctx('u1'), 'nope', { meta: { displayName: 'X' } });
			} catch (err) {
				thrown = err;
			}
			expect(thrown).toBeTruthy();
			const e = thrown as { statusCode?: number };
			expect(e.statusCode).toBe(404);
		});

		it('status flip pending → ready via update', async () => {
			const store = await createStore();
			await store.create(ctx('u1'), record({ guid: 'x', status: 'pending' }));

			const beforeFlip = await store.list(ctx('u1'));
			expect(beforeFlip.items.map((r) => r.guid)).not.toContain('x');

			await store.update(ctx('u1'), 'x', { status: 'ready' });
			const afterFlip = await store.list(ctx('u1'));
			expect(afterFlip.items.map((r) => r.guid)).toContain('x');
		});

		it('addHistoryEntry prepends entries (newest first)', async () => {
			const store = await createStore();
			await store.create(ctx('u1'), record({ guid: 'h', maxHistory: 0 }));

			const e1: HistoryEntry = { ref: 'r1', originalName: 'a.gh', archivedAt: '2024-01-01' };
			const e2: HistoryEntry = { ref: 'r2', originalName: 'b.gh', archivedAt: '2024-01-02' };
			await store.addHistoryEntry(ctx('u1'), 'h', e1);
			await store.addHistoryEntry(ctx('u1'), 'h', e2);

			const got = await store.get(ctx('u1'), 'h');
			expect(got!.history.map((h) => h.ref)).toEqual(['r2', 'r1']);
		});

		it('removeHistoryEntry removes the matching ref', async () => {
			const store = await createStore();
			const entry: HistoryEntry = { ref: 'keep', originalName: 'a.gh', archivedAt: '2024-01-01' };
			const drop: HistoryEntry = { ref: 'drop', originalName: 'b.gh', archivedAt: '2024-01-02' };
			await store.create(ctx('u1'), record({ guid: 'h', history: [drop, entry] }));

			await store.removeHistoryEntry(ctx('u1'), 'h', 'drop');
			const got = await store.get(ctx('u1'), 'h');
			expect(got!.history.map((h) => h.ref)).toEqual(['keep']);
		});

		it('delete removes the record', async () => {
			const store = await createStore();
			await store.create(ctx('u1'), record({ guid: 'd' }));
			await store.delete(ctx('u1'), 'd');
			const got = await store.get(ctx('u1'), 'd');
			expect(got).toBeNull();
		});

		it('listPublic returns only ready records', async () => {
			const store = await createStore();
			await store.create(ctx('u1'), record({ guid: 'pub-ready', status: 'ready' }));
			await store.create(ctx('u1'), record({ guid: 'pub-pending', status: 'pending' }));

			const page = await store.listPublic(ctx('u1'));
			expect(page.items.map((r) => r.guid)).toContain('pub-ready');
			expect(page.items.map((r) => r.guid)).not.toContain('pub-pending');
		});

		it('listStalePending returns only pending + older than cutoff', async () => {
			const store = await createStore();
			const old = '2024-01-01T00:00:00.000Z';
			const recent = new Date().toISOString();

			await store.create(
				ctx('u1'),
				record({ guid: 'old-pending', status: 'pending', createdAt: old })
			);
			await store.create(
				ctx('u1'),
				record({ guid: 'new-pending', status: 'pending', createdAt: recent })
			);
			await store.create(ctx('u1'), record({ guid: 'old-ready', status: 'ready', createdAt: old }));

			const cutoff = '2024-06-01T00:00:00.000Z';
			const stale = await store.listStalePending(SYSTEM_CONTEXT, cutoff);
			const guids = stale.map((r) => r.guid);
			expect(guids).toContain('old-pending');
			expect(guids).not.toContain('new-pending');
			expect(guids).not.toContain('old-ready');
		});

		it('pagination respects limit and nextCursor', async () => {
			const store = await createStore();
			for (let i = 0; i < 5; i++) {
				await store.create(ctx('u1'), record({ guid: `p${i}`, meta: { displayName: `N${i}` } }));
			}

			const first = await store.list(ctx('u1'), { limit: 2 });
			expect(first.items.length).toBe(2);
			expect(first.nextCursor).toBeTruthy();

			const second = await store.list(ctx('u1'), { limit: 2, cursor: first.nextCursor });
			expect(second.items.length).toBe(2);
			const firstGuids = first.items.map((r) => r.guid);
			for (const item of second.items) {
				expect(firstGuids).not.toContain(item.guid);
			}
		});

		if (ctxIsolation) {
			it('ctx isolation: records created by one user are not visible to another', async () => {
				const store = await createStore();
				await store.create(ctx('user-a'), record({ guid: 'a1', projectId: 'proj-a' }));

				const page = await store.list(ctx('user-b'));
				expect(page.items.map((r) => r.guid)).not.toContain('a1');
			});

			it('ctx isolation: user cannot get a record they do not own', async () => {
				const store = await createStore();
				await store.create(ctx('user-a'), record({ guid: 'a1' }));

				const got = await store.get(ctx('user-b'), 'a1');
				expect(got).toBeNull();
			});
		}
	});
}
