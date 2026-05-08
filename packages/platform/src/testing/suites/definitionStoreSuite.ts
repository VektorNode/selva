/**
 * Adapter conformance suite for IDefinitionStore.
 *
 * The goal is to prove every adapter behaves identically from the consuming
 * app's perspective — `ctx` scoping, `pending` filtering, version CRUD +
 * reference protection (spec §6), and error shapes.
 */

import { describe, it, expect } from 'vitest';
import type { IDefinitionStore } from '../../definitions/interface.js';
import type { DefinitionRecord, DefinitionVersion } from '../../definitions/types.js';
import { makeCtx, makeUuid } from './helpers.js';
import type { RequestContext } from '../../context.js';

/**
 * Scope the suite needs to reference from each test. Adapters that enforce
 * FK constraints (Supabase) return real uuids they've seeded; adapters that
 * don't (local JSON) can omit this and the suite uses the defaults.
 */
export interface DefinitionTestScope {
	/** Primary owner. Every record and ctx in the suite uses this id. */
	ownerId: string;
	/**
	 * Optional access token for `ownerId`. Required for adapters that enforce
	 * auth at the DB layer (Supabase RLS); ignored by local providers.
	 */
	ownerSessionToken?: string;
	/** Default project id. Returned by `primaryProjectId()` in the suite. */
	projectId: string;
	/**
	 * Second project id used by `listByProject` tests to prove filtering.
	 * Must reference a real row for FK-enforcing adapters.
	 */
	secondaryProjectId: string;
	/** Optional third user id for ctx-isolation tests. Required when ctxIsolation is set. */
	secondaryUserId?: string;
	/** Token for `secondaryUserId`, when used. */
	secondaryUserSessionToken?: string;
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

// Suite-wide token map. `scopeFor` populates it from the scope; `ctx`
// auto-attaches the matching token so adapters with DB-side auth (Supabase
// RLS) run as the right user. Local providers ignore tokens entirely.
const tokens = new Map<string, string>();

function ctx(
	userId: string,
	opts: {
		actingOrgId?: string;
		platformPermissions?: RequestContext['platformPermissions'];
		orgPermissions?: RequestContext['orgPermissions'];
	} = {}
): RequestContext {
	return makeCtx(userId, { ...opts, sessionToken: tokens.get(userId) });
}

function recordTokensFromScope(scope: DefinitionTestScope): void {
	if (scope.ownerSessionToken) tokens.set(scope.ownerId, scope.ownerSessionToken);
	if (scope.secondaryUserId && scope.secondaryUserSessionToken) {
		tokens.set(scope.secondaryUserId, scope.secondaryUserSessionToken);
	}
}

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
		displayName: overrides.displayName ?? 'Test',
		status: overrides.status ?? 'published',
		solveCount: overrides.solveCount ?? 0,
		liveVersionId: overrides.liveVersionId ?? null,
		draftVersionId: overrides.draftVersionId ?? null,
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		deletedAt: overrides.deletedAt ?? null,
		...overrides
	};
}

function version(
	definitionId: string,
	versionNumber: number,
	uploadedBy: string,
	overrides: Partial<DefinitionVersion> = {}
): DefinitionVersion {
	return {
		id: overrides.id ?? makeUuid(),
		definitionId,
		versionNumber,
		fileExt: overrides.fileExt ?? 'gh',
		fileKey: overrides.fileKey ?? `definitions/${definitionId}/versions/v${versionNumber}.gh`,
		originalFilename: overrides.originalFilename,
		uploadedBy,
		uploadedAt: overrides.uploadedAt ?? new Date().toISOString(),
		...overrides
	};
}

export function runDefinitionStoreConformance(opts: DefinitionStoreConformanceOptions): void {
	const { name, createStore, createScope, ctxIsolation = false } = opts;
	const scopeFor = async (): Promise<DefinitionTestScope> => {
		const s = createScope ? await createScope() : DEFAULT_SCOPE;
		recordTokensFromScope(s);
		return s;
	};

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
			await store.create(ctx(scope.ownerId), record(scope, { guid: pub, status: 'published' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: dft, status: 'draft' }));

			const page = await store.list(ctx(scope.ownerId), { statuses: ['draft'] });
			const guids = page.items.map((r) => r.guid);
			expect(guids).toContain(dft);
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

		it('incrementSolveCount increases solveCount by 1', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, solveCount: 5 }));
			await store.incrementSolveCount(ctx(scope.ownerId), guid);
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.solveCount).toBe(6);
		});

		it('incrementSolveCount is a no-op for missing guid', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			let threw = false;
			try {
				await store.incrementSolveCount(ctx(scope.ownerId), makeUuid());
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

		// ============================================================================
		// Versions (spec §6)
		// ============================================================================

		it('createVersion + listVersions: rows return newest-first by versionNumber', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));

			const v1 = version(guid, 1, scope.ownerId);
			const v2 = version(guid, 2, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v1);
			await store.createVersion(ctx(scope.ownerId), v2);

			const page = await store.listVersions(ctx(scope.ownerId), guid);
			expect(page.items.map((v) => v.versionNumber)).toEqual([2, 1]);
			expect(page.items.map((v) => v.id)).toEqual([v2.id, v1.id]);
		});

		it('getVersion returns the row by id', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const v1 = version(guid, 1, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v1);

			const got = await store.getVersion(ctx(scope.ownerId), v1.id);
			expect(got?.id).toBe(v1.id);
			expect(got?.versionNumber).toBe(1);
		});

		it('setLiveVersion + setDraftVersion repoint channels', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const v1 = version(guid, 1, scope.ownerId);
			const v2 = version(guid, 2, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v1);
			await store.createVersion(ctx(scope.ownerId), v2);

			await store.setDraftVersion(ctx(scope.ownerId), guid, v2.id);
			let got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.draftVersionId).toBe(v2.id);
			expect(got?.liveVersionId).toBeNull();

			await store.setLiveVersion(ctx(scope.ownerId), guid, v1.id);
			got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.liveVersionId).toBe(v1.id);
			expect(got?.draftVersionId).toBe(v2.id);
		});

		it('attachInitialVersion: bootstraps both pointers + status atomically', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			// Mirrors what DefinitionService.create writes: status='pending',
			// no pointers — the state attachInitialVersion is meant to advance.
			await store.create(ctx(scope.ownerId), record(scope, { guid, status: 'pending' }));
			const v1 = version(guid, 1, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v1);

			await store.attachInitialVersion(ctx(scope.ownerId), guid, v1.id);

			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.status).toBe('draft');
			expect(got?.liveVersionId).toBe(v1.id);
			expect(got?.draftVersionId).toBe(v1.id);
		});

		it('attachInitialVersion: rejects a version belonging to another definition', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guidA = makeUuid();
			const guidB = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: guidA, status: 'pending' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: guidB, status: 'pending' }));
			const vForB = version(guidB, 1, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), vForB);

			let thrown: unknown;
			try {
				await store.attachInitialVersion(ctx(scope.ownerId), guidA, vForB.id);
			} catch (err) {
				thrown = err;
			}
			expect((thrown as { statusCode?: number })?.statusCode).toBe(404);

			// And A's state must still be the bootstrap-pending shape.
			const got = await store.get(ctx(scope.ownerId), guidA);
			expect(got?.status).toBe('pending');
			expect(got?.liveVersionId).toBeNull();
			expect(got?.draftVersionId).toBeNull();
		});

		it('setLiveVersion rejects a version belonging to another definition', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guidA = makeUuid();
			const guidB = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: guidA }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: guidB }));
			const vForB = version(guidB, 1, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), vForB);

			let thrown: unknown;
			try {
				await store.setLiveVersion(ctx(scope.ownerId), guidA, vForB.id);
			} catch (err) {
				thrown = err;
			}
			expect((thrown as { statusCode?: number })?.statusCode).toBe(404);
		});

		it('deleteVersion: succeeds when not referenced by live or draft', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const v1 = version(guid, 1, scope.ownerId);
			const v2 = version(guid, 2, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v1);
			await store.createVersion(ctx(scope.ownerId), v2);
			await store.setLiveVersion(ctx(scope.ownerId), guid, v2.id);
			await store.setDraftVersion(ctx(scope.ownerId), guid, v2.id);

			await store.deleteVersion(ctx(scope.ownerId), v1.id);
			const remaining = await store.listVersions(ctx(scope.ownerId), guid);
			expect(remaining.items.map((v) => v.id)).toEqual([v2.id]);
		});

		it('deleteVersion: throws 409 when the version is referenced by liveVersionId', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const v1 = version(guid, 1, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v1);
			await store.setLiveVersion(ctx(scope.ownerId), guid, v1.id);

			let thrown: unknown;
			try {
				await store.deleteVersion(ctx(scope.ownerId), v1.id);
			} catch (err) {
				thrown = err;
			}
			expect((thrown as { statusCode?: number })?.statusCode).toBe(409);
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
		// Audit fields + soft delete
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
