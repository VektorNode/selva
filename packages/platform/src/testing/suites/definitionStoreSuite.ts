/**
 * Adapter conformance suite for IDefinitionStore.
 *
 * The goal is to prove every adapter behaves identically from the consuming
 * app's perspective — `ctx` scoping, `pending` filtering, `listStalePending`
 * cutoff, history mutations, and error shapes.
 */

import { describe, it, expect } from 'vitest';
import type { IDefinitionStore } from '../../data/interface.js';
import type { DefinitionRecord, HistoryEntry } from '../../definitions/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeCtx, makeUuid } from './helpers.js';

/**
 * Scope the suite needs to reference from each test. Adapters that enforce
 * FK constraints (Supabase) return real uuids they've seeded; adapters that
 * don't (local JSON) can omit this and the suite uses the defaults.
 */
export interface DefinitionTestScope {
	/** Primary owner. Every record and ctx in the suite uses this id. */
	ownerId: string;
	/** Default project id. Returned by `primaryProjectId()` in the suite. */
	projectId: string;
	/**
	 * Second project id used by `listByProject` tests to prove filtering.
	 * Must reference a real row for FK-enforcing adapters.
	 */
	secondaryProjectId: string;
	/** Optional third user id for ctx-isolation tests. Required when ctxIsolation is set. */
	secondaryUserId?: string;
}

export interface DefinitionStoreConformanceOptions {
	/** Name to show in the test output (e.g. "local-provider"). */
	name: string;
	/** Factory that returns a fresh, empty store per test. */
	createStore: () => Promise<IDefinitionStore> | IDefinitionStore;
	/**
	 * Per-test scope factory. Called once in each `it` block. Adapters with FK
	 * constraints seed the necessary `auth.users` / `projects` rows here and
	 * return the generated ids; adapters without FKs can return stub ids.
	 */
	createScope?: () => Promise<DefinitionTestScope> | DefinitionTestScope;
	/**
	 * Set to true for adapters that enforce per-user ctx scoping (e.g. Supabase RLS).
	 * When false, ctx-isolation tests are skipped (local JSON adapter shares all records).
	 */
	ctxIsolation?: boolean;
}

const DEFAULT_SCOPE: DefinitionTestScope = {
	ownerId: 'user-1',
	projectId: 'project-1',
	secondaryProjectId: 'project-2',
	secondaryUserId: 'user-b'
};

const ctx = makeCtx;

function record(
	scope: DefinitionTestScope,
	overrides: Partial<DefinitionRecord> = {}
): DefinitionRecord {
	const now = new Date().toISOString();
	return {
		guid: overrides.guid ?? makeUuid(),
		projectId: overrides.projectId ?? scope.projectId,
		ownerId: overrides.ownerId ?? scope.ownerId,
		createdBy: overrides.createdBy ?? scope.ownerId,
		updatedBy: overrides.updatedBy ?? scope.ownerId,
		fileExt: overrides.fileExt ?? 'gh',
		displayName: overrides.displayName ?? 'Test',
		history: overrides.history ?? [],
		maxHistory: overrides.maxHistory ?? 10,
		status: overrides.status ?? 'published',
		runCount: overrides.runCount ?? 0,
		liveVersionId: overrides.liveVersionId ?? null,
		draftVersionId: overrides.draftVersionId ?? null,
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		deletedAt: overrides.deletedAt ?? null,
		...overrides
	};
}

export function runDefinitionStoreConformance(opts: DefinitionStoreConformanceOptions): void {
	const { name, createStore, createScope, ctxIsolation = false } = opts;
	const scopeFor = async (): Promise<DefinitionTestScope> =>
		createScope ? await createScope() : DEFAULT_SCOPE;

	describe(`IDefinitionStore conformance: ${name}`, () => {
		it('create + get returns the record', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			const rec = record(scope, { guid });
			await store.create(ctx(scope.ownerId), rec);
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.guid).toBe(guid);
		});

		it('get returns null for missing guid', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const got = await store.get(ctx(scope.ownerId), makeUuid());
			expect(got).toBeNull();
		});

		it('list filters pending by default', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const pub = makeUuid();
			const pend = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: pub, status: 'published' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: pend, status: 'pending' }));

			const page = await store.list(ctx(scope.ownerId));
			const guids = page.items.map((r) => r.guid);
			expect(guids).toContain(pub);
			expect(guids).not.toContain(pend);
		});

		it('list with includePending returns pending too', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const pub = makeUuid();
			const pend = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: pub, status: 'published' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: pend, status: 'pending' }));

			const page = await store.list(ctx(scope.ownerId), { includePending: true });
			const guids = page.items.map((r) => r.guid);
			expect(guids).toContain(pub);
			expect(guids).toContain(pend);
		});

		it('list with statuses filter returns only matching statuses', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const pub = makeUuid();
			const dft = makeUuid();
			const rev = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: pub, status: 'published' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: dft, status: 'draft' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: rev, status: 'review' }));

			const page = await store.list(ctx(scope.ownerId), { statuses: ['draft', 'review'] });
			const guids = page.items.map((r) => r.guid);
			expect(guids).toContain(dft);
			expect(guids).toContain(rev);
			expect(guids).not.toContain(pub);
		});

		it('listByProject filters by projectId', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const a = makeUuid();
			const b = makeUuid();
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: a, projectId: scope.projectId })
			);
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: b, projectId: scope.secondaryProjectId })
			);

			const page = await store.listByProject(ctx(scope.ownerId), scope.projectId);
			expect(page.items.map((r) => r.guid)).toEqual([a]);
		});

		it('update applies patch and bumps updatedAt', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			const created = record(scope, { guid, displayName: 'Old' });
			await store.create(ctx(scope.ownerId), created);

			await store.update(ctx(scope.ownerId), guid, { displayName: 'New' });
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.displayName).toBe('New');
			expect(got!.updatedAt >= created.updatedAt).toBe(true);
		});

		it('update on missing guid throws ProviderError with status 404', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			let thrown: unknown;
			try {
				await store.update(ctx(scope.ownerId), makeUuid(), { displayName: 'X' });
			} catch (err) {
				thrown = err;
			}
			expect(thrown).toBeTruthy();
			const e = thrown as { statusCode?: number };
			expect(e.statusCode).toBe(404);
		});

		it('status flip pending → published via update', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, status: 'pending' }));

			const beforeFlip = await store.list(ctx(scope.ownerId));
			expect(beforeFlip.items.map((r) => r.guid)).not.toContain(guid);

			await store.update(ctx(scope.ownerId), guid, { status: 'published' });
			const afterFlip = await store.list(ctx(scope.ownerId));
			expect(afterFlip.items.map((r) => r.guid)).toContain(guid);
		});

		it('incrementRunCount increases runCount by 1', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, runCount: 5 }));
			await store.incrementRunCount(ctx(scope.ownerId), guid);
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.runCount).toBe(6);
		});

		it('incrementRunCount is a no-op for missing guid', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			let threw = false;
			try {
				await store.incrementRunCount(ctx(scope.ownerId), makeUuid());
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		it('update advances updatedBy to the caller', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			const editor = scope.secondaryUserId ?? makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			// Editing as a different user — updatedBy should advance.
			await store.update(ctx(editor), guid, { displayName: 'Renamed' });
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.updatedBy).toBe(editor);
			expect(got?.createdBy).toBe(scope.ownerId);
		});

		it('addHistoryEntry prepends entries (newest first)', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, maxHistory: 0 }));

			const e1: HistoryEntry = { ref: 'r1', originalName: 'a.gh', archivedAt: '2024-01-01T00:00:00.000Z' };
			const e2: HistoryEntry = { ref: 'r2', originalName: 'b.gh', archivedAt: '2024-01-02T00:00:00.000Z' };
			await store.addHistoryEntry(ctx(scope.ownerId), guid, e1);
			await store.addHistoryEntry(ctx(scope.ownerId), guid, e2);

			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got!.history.map((h) => h.ref)).toEqual(['r2', 'r1']);
		});

		it('removeHistoryEntry removes the matching ref', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			const entry: HistoryEntry = { ref: 'keep', originalName: 'a.gh', archivedAt: '2024-01-01T00:00:00.000Z' };
			const drop: HistoryEntry = { ref: 'drop', originalName: 'b.gh', archivedAt: '2024-01-02T00:00:00.000Z' };
			await store.create(ctx(scope.ownerId), record(scope, { guid, history: [drop, entry] }));

			await store.removeHistoryEntry(ctx(scope.ownerId), guid, 'drop');
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got!.history.map((h) => h.ref)).toEqual(['keep']);
		});

		it('delete removes the record', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			await store.delete(ctx(scope.ownerId), guid);
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got).toBeNull();
		});

		// ============================================================================
		// B3: audit fields + soft delete
		// ============================================================================

		it('create populates createdBy/updatedBy and deletedAt=null', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.createdBy).toBe(scope.ownerId);
			expect(got?.updatedBy).toBe(scope.ownerId);
			expect(got?.deletedAt ?? null).toBeNull();
		});

		it('versioning scaffold: liveVersionId/draftVersionId default to null on create', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.liveVersionId ?? null).toBeNull();
			expect(got?.draftVersionId ?? null).toBeNull();
		});

		it('delete soft-deletes — record excluded from list/listByProject', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, status: 'published' }));
			await store.delete(ctx(scope.ownerId), guid);
			const all = await store.list(ctx(scope.ownerId), { limit: 500 });
			expect(all.items.map((r) => r.guid)).not.toContain(guid);
			const byProject = await store.listByProject(ctx(scope.ownerId), scope.projectId, {
				limit: 500
			});
			expect(byProject.items.map((r) => r.guid)).not.toContain(guid);
		});

		it('listPublic returns published records, not pending', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const pub = makeUuid();
			const pend = makeUuid();
			const dft = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: pub, status: 'published' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: pend, status: 'pending' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: dft, status: 'draft' }));

			const page = await store.listPublic(ctx(scope.ownerId));
			expect(page.items.map((r) => r.guid)).toContain(pub);
			expect(page.items.map((r) => r.guid)).not.toContain(pend);
		});

		it('listStalePending returns only pending + older than cutoff', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const oldISO = '2024-01-01T00:00:00.000Z';
			const recentISO = new Date().toISOString();

			const oldPending = makeUuid();
			const newPending = makeUuid();
			const oldReady = makeUuid();
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: oldPending, status: 'pending', createdAt: oldISO, updatedAt: oldISO })
			);
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: newPending, status: 'pending', createdAt: recentISO, updatedAt: recentISO })
			);
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: oldReady, status: 'published', createdAt: oldISO, updatedAt: oldISO })
			);

			const cutoff = '2024-06-01T00:00:00.000Z';
			const stale = await store.listStalePending(SYSTEM_CONTEXT, cutoff);
			const guids = stale.map((r) => r.guid);
			expect(guids).toContain(oldPending);
			expect(guids).not.toContain(newPending);
			expect(guids).not.toContain(oldReady);
		});

		it('pagination respects limit and nextCursor', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			for (let i = 0; i < 5; i++) {
				await store.create(ctx(scope.ownerId), record(scope, { displayName: `N${i}` }));
			}

			const first = await store.list(ctx(scope.ownerId), { limit: 2 });
			expect(first.items.length).toBe(2);
			expect(first.nextCursor).toBeTruthy();

			const second = await store.list(ctx(scope.ownerId), { limit: 2, cursor: first.nextCursor });
			expect(second.items.length).toBe(2);
			const firstGuids = first.items.map((r) => r.guid);
			for (const item of second.items) {
				expect(firstGuids).not.toContain(item.guid);
			}
		});

		if (ctxIsolation) {
			it('ctx isolation: records created by one user are not visible to another', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const otherUser = scope.secondaryUserId;
				if (!otherUser) throw new Error('ctxIsolation requires scope.secondaryUserId');
				const guid = makeUuid();
				await store.create(ctx(scope.ownerId), record(scope, { guid }));

				const page = await store.list(ctx(otherUser));
				expect(page.items.map((r) => r.guid)).not.toContain(guid);
			});

			it('ctx isolation: user cannot get a record they do not own', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const otherUser = scope.secondaryUserId;
				if (!otherUser) throw new Error('ctxIsolation requires scope.secondaryUserId');
				const guid = makeUuid();
				await store.create(ctx(scope.ownerId), record(scope, { guid }));

				const got = await store.get(ctx(otherUser), guid);
				expect(got).toBeNull();
			});
		}
	});
}
