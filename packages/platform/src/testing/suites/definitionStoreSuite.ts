/**
 * Adapter conformance suite for IDefinitionStore: `pending` filtering, version
 * CRUD and reference protection, error shapes, and (opt-in) `ctx` scoping.
 */

import { describe, it, expect } from 'vitest';
import type { IDefinitionStore } from '../../definitions/interface.js';
import type { DefinitionRecord, DefinitionVersion } from '../../definitions/types.js';
import {
	expectStatus,
	makeExpectDenied,
	makeSeedHelpers,
	makeUuid,
	nextTick,
	noopSeedUser
} from './helpers.js';

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
	/** Default project id. Must be public when `publicListing` is set. */
	projectId: string;
	/**
	 * Second project id used by `listByProject` tests to prove filtering.
	 * Must reference a real row for FK-enforcing adapters.
	 */
	secondaryProjectId: string;
	/**
	 * A project that isn't public. The ctx-isolation cases use it when `projectId` is
	 * one anyone can see; `publicListing` requires it.
	 */
	privateProjectId?: string;
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
	 * The adapter scopes reads by `ctx` in the store (Supabase RLS), so a user with no
	 * stake in the project sees nothing. An adapter that leaves scoping to the server
	 * guards (local) skips these cases.
	 */
	ctxIsolation?: boolean;
	/** Denials assert the `ProviderError` status, not just a rejection. */
	strictDenials?: boolean;
	/** The default `ctx` holds no platform permissions, so no case passes on an `instance_admin` bypass. */
	nonAdminCtx?: boolean;
	/**
	 * Audit fields are checked against values the test didn't write: a creator who
	 * isn't the owner keeps `createdBy`, and `update` moves `updatedAt` strictly later.
	 */
	auditStamps?: boolean;
	/** `listPublic` leaves out definitions in a non-public project and keeps drafts. */
	publicListing?: boolean;
}

const DEFAULT_SCOPE: DefinitionTestScope = {
	ownerId: 'user-1',
	projectId: 'project-1',
	secondaryProjectId: 'project-2',
	secondaryUserId: 'user-b'
};

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
		nextVersionNumber: overrides.nextVersionNumber ?? 2,
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
	const {
		name,
		createStore,
		createScope,
		ctxIsolation = false,
		strictDenials = false,
		nonAdminCtx = false,
		auditStamps = false,
		publicListing = false
	} = opts;
	const { ctx, scopeFrom } = makeSeedHelpers(noopSeedUser, { nonAdminCtx });
	const expectDenied = makeExpectDenied(strictDenials);
	const scopeFor = scopeFrom(createScope, DEFAULT_SCOPE, (s) => [
		{ userId: s.ownerId, sessionToken: s.ownerSessionToken },
		{ userId: s.secondaryUserId, sessionToken: s.secondaryUserSessionToken }
	]);

	describe(`IDefinitionStore conformance: ${name}`, () => {
		it('get returns null for missing guid', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const got = await store.get(ctx(scope.ownerId), makeUuid());
			expect(got).toBeNull();
		});

		it('getDefinitionsFor returns the live record per guid, leaving out missing and deleted', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const [a, b, gone] = [makeUuid(), makeUuid(), makeUuid()];
			for (const guid of [a, b, gone])
				await store.create(ctx(scope.ownerId), record(scope, { guid }));
			await store.delete(ctx(scope.ownerId), gone);

			const found = await store.getDefinitionsFor(ctx(scope.ownerId), [a, b, gone, makeUuid()]);
			expect([...found.keys()].sort()).toEqual([a, b].sort());
			expect(found.get(a)?.guid).toBe(a);
			expect((await store.getDefinitionsFor(ctx(scope.ownerId), [])).size).toBe(0);
		});

		it('list filters pending by default and returns it with includePending', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const pub = makeUuid();
			const pend = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: pub, status: 'published' }));
			await store.create(ctx(scope.ownerId), record(scope, { guid: pend, status: 'pending' }));

			const byDefault = (await store.list(ctx(scope.ownerId))).items.map((r) => r.guid);
			expect(byDefault).toContain(pub);
			expect(byDefault).not.toContain(pend);

			const withPending = (await store.list(ctx(scope.ownerId), { includePending: true })).items;
			expect(withPending.map((r) => r.guid)).toEqual(expect.arrayContaining([pub, pend]));
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

		it('list applies the projectIds filter before the page limit', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const visible = makeUuid();
			const hidden = makeUuid();
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: visible, projectId: scope.projectId })
			);
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: hidden, projectId: scope.secondaryProjectId })
			);

			// The filter has to run in the query, not over the fetched page: with a
			// limit of 1 a post-hoc filter can return zero items and still report a
			// cursor, which is what makes paginated visibility filtering incorrect.
			const page = await store.list(ctx(scope.ownerId), {
				projectIds: [scope.projectId],
				limit: 1
			});
			expect(page.items.map((r) => r.guid)).toEqual([visible]);
		});

		it('list with an empty projectIds filter matches nothing', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: makeUuid(), projectId: scope.projectId })
			);

			const page = await store.list(ctx(scope.ownerId), { projectIds: [] });
			expect(page.items).toEqual([]);
		});

		it('update applies patch and bumps updatedAt', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			const created = record(scope, { guid, displayName: 'Old' });
			await store.create(ctx(scope.ownerId), created);
			await nextTick();

			await store.update(ctx(scope.ownerId), guid, { displayName: 'New' });
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.displayName).toBe('New');
			if (auditStamps) {
				expect(Date.parse(got!.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
			} else {
				expect(got!.updatedAt >= created.updatedAt).toBe(true);
			}
		});

		it('update with null tags clears them', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, tags: ['roof'] }));

			await store.update(ctx(scope.ownerId), guid, { tags: null });
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.tags ?? []).toEqual([]);
		});

		it('solveCacheLimit round-trips: absent → inherit, set → value, null → cleared', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));

			// Absent on create → undefined (inherit the global default).
			expect((await store.get(ctx(scope.ownerId), guid))?.solveCacheLimit).toBeUndefined();

			// Set a per-definition quota.
			await store.update(ctx(scope.ownerId), guid, { solveCacheLimit: 25 });
			expect((await store.get(ctx(scope.ownerId), guid))?.solveCacheLimit).toBe(25);

			// 0 means "caching off" and must persist as 0 (distinct from absent/inherit).
			await store.update(ctx(scope.ownerId), guid, { solveCacheLimit: 0 });
			expect((await store.get(ctx(scope.ownerId), guid))?.solveCacheLimit).toBe(0);

			// null clears back to inherit.
			await store.update(ctx(scope.ownerId), guid, { solveCacheLimit: null });
			expect((await store.get(ctx(scope.ownerId), guid))?.solveCacheLimit).toBeUndefined();
		});

		it('sourceDocumentId round-trips through create, update and clear', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			const docA = makeUuid();
			const docB = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, sourceDocumentId: docA }));
			expect((await store.get(ctx(scope.ownerId), guid))?.sourceDocumentId).toBe(docA);

			await store.update(ctx(scope.ownerId), guid, { sourceDocumentId: docB });
			expect((await store.get(ctx(scope.ownerId), guid))?.sourceDocumentId).toBe(docB);

			await store.update(ctx(scope.ownerId), guid, { sourceDocumentId: null });
			expect((await store.get(ctx(scope.ownerId), guid))?.sourceDocumentId).toBeUndefined();
		});

		it('list filters by sourceDocumentId in the query', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const doc = makeUuid();
			const match = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid: match, sourceDocumentId: doc }));
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: makeUuid(), sourceDocumentId: makeUuid() })
			);
			await store.create(ctx(scope.ownerId), record(scope, { guid: makeUuid() }));

			const page = await store.list(ctx(scope.ownerId), {
				sourceDocumentId: doc,
				projectIds: [scope.projectId],
				limit: 1
			});
			expect(page.items.map((r) => r.guid)).toEqual([match]);
			expect(page.nextCursor).toBeUndefined();
		});

		it('update on missing guid throws ProviderError with status 404', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			await expectStatus(store.update(ctx(scope.ownerId), makeUuid(), { displayName: 'X' }), 404);
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
			await store.incrementSolveCount(ctx(scope.ownerId), makeUuid());
		});

		it('reserveNextVersionNumber returns the record counter then advances it', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, nextVersionNumber: 2 }));

			const first = await store.reserveNextVersionNumber(ctx(scope.ownerId), guid);
			const second = await store.reserveNextVersionNumber(ctx(scope.ownerId), guid);
			expect(first).toBe(2);
			expect(second).toBe(3);
			// Counter persisted, never reused.
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.nextVersionNumber).toBe(4);
		});

		it('reserveNextVersionNumber mints a FRESH number after delete-latest (fileKeys never collide)', async () => {
			// The counter exists because max(existing)+1 would reuse a deleted number
			// and collide the fileKey, so it must go beyond any deleted version's.
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid, nextVersionNumber: 2 }));

			// Simulate an upload of v2 (reserve, create), then delete it.
			const n2 = await store.reserveNextVersionNumber(ctx(scope.ownerId), guid);
			expect(n2).toBe(2);
			const v2 = version(guid, n2, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v2);
			await store.deleteVersion(ctx(scope.ownerId), v2.id);

			// The next reservation must be 3 — NOT 2 again — even though the highest
			// surviving version number is now 1 (v1 was never created here; the point
			// is the counter ignores the version list entirely).
			const n3 = await store.reserveNextVersionNumber(ctx(scope.ownerId), guid);
			expect(n3).toBe(3);
			expect(n3).not.toBe(n2);
		});

		it('reserveNextVersionNumber throws for a missing definition', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			await expectDenied(store.reserveNextVersionNumber(ctx(scope.ownerId), makeUuid()), 404);
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
		// Versions
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

		it('listVersionsFor returns each definition’s versions newest-first, without the schema', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const [a, b, none] = [makeUuid(), makeUuid(), makeUuid()];
			for (const guid of [a, b, none])
				await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const a1 = version(a, 1, scope.ownerId);
			const a2 = version(a, 2, scope.ownerId);
			const b1 = version(b, 1, scope.ownerId);
			for (const v of [a1, b1, a2]) await store.createVersion(ctx(scope.ownerId), v);
			await store.setVersionSchema(ctx(scope.ownerId), a2.id, {
				name: 'Test',
				inputs: [],
				outputs: []
			} as unknown as Parameters<typeof store.setVersionSchema>[2]);

			const byDefinition = await store.listVersionsFor(ctx(scope.ownerId), [a, b, none]);
			expect(byDefinition.get(a)?.map((v) => v.id)).toEqual([a2.id, a1.id]);
			expect(byDefinition.get(b)?.map((v) => v.id)).toEqual([b1.id]);
			expect(byDefinition.get(none)).toEqual([]);
			expect(byDefinition.get(a)?.[0]?.schema).toBeUndefined();
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

		it('setVersionSchema persists a cached schema on the version', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			await store.create(ctx(scope.ownerId), record(scope, { guid }));
			const v1 = version(guid, 1, scope.ownerId);
			await store.createVersion(ctx(scope.ownerId), v1);
			expect((await store.getVersion(ctx(scope.ownerId), v1.id))?.schema).toBeUndefined();

			const schema = {
				name: 'Test',
				inputs: [],
				outputs: []
			} as unknown as Parameters<typeof store.setVersionSchema>[2];
			await store.setVersionSchema(ctx(scope.ownerId), v1.id, schema);

			const got = await store.getVersion(ctx(scope.ownerId), v1.id);
			expect(got?.schema).toEqual(schema);
			expect(got?.schemaExtractedAt).toBeTypeOf('string');
		});

		it('setVersionSchema is a no-op for a missing version', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const schema = { name: 'X', inputs: [], outputs: [] } as unknown as Parameters<
				typeof store.setVersionSchema
			>[2];
			await expect(
				store.setVersionSchema(ctx(scope.ownerId), makeUuid(), schema)
			).resolves.toBeUndefined();
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

		it('attachInitialVersion sets both pointers and flips status to draft', async () => {
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

			await expectStatus(store.attachInitialVersion(ctx(scope.ownerId), guidA, vForB.id), 404);

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

			await expectStatus(store.setLiveVersion(ctx(scope.ownerId), guidA, vForB.id), 404);
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

			await expectStatus(store.deleteVersion(ctx(scope.ownerId), v1.id), 409);
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

		it('create stores createdBy and updatedBy, and no deletedAt', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const guid = makeUuid();
			// Under auditStamps someone other than the owner creates it, so a store that
			// copies ownerId into createdBy fails.
			const creator = auditStamps ? (scope.secondaryUserId ?? makeUuid()) : scope.ownerId;
			await store.create(
				ctx(creator),
				record(scope, { guid, createdBy: creator, updatedBy: creator })
			);
			const got = await store.get(ctx(scope.ownerId), guid);
			expect(got?.createdBy).toBe(creator);
			expect(got?.updatedBy).toBe(creator);
			expect(got?.deletedAt ?? null).toBeNull();
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

		it('deleteByProject soft-deletes every definition in the project, leaving others', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			// Two published definitions in the target project, one in another —
			// the cascade must tombstone the target project's and leave the rest.
			const a = makeUuid();
			const b = makeUuid();
			const other = makeUuid();
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: a, projectId: scope.projectId, status: 'published' })
			);
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: b, projectId: scope.projectId, status: 'published' })
			);
			await store.create(
				ctx(scope.ownerId),
				record(scope, { guid: other, projectId: scope.secondaryProjectId, status: 'published' })
			);

			await store.deleteByProject(ctx(scope.ownerId), scope.projectId);

			// Both target-project definitions gone from every read path…
			expect(await store.get(ctx(scope.ownerId), a)).toBeNull();
			expect(await store.get(ctx(scope.ownerId), b)).toBeNull();
			const targetList = await store.listByProject(ctx(scope.ownerId), scope.projectId, {
				limit: 500
			});
			expect(targetList.items).toHaveLength(0);
			const all = await store.list(ctx(scope.ownerId), { limit: 500 });
			expect(all.items.map((r) => r.guid)).not.toContain(a);
			expect(all.items.map((r) => r.guid)).not.toContain(b);
			// …but the other project's definition survives.
			expect(await store.get(ctx(scope.ownerId), other)).not.toBeNull();
		});

		it('deleteByProject is a no-op when the project has no definitions', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			await expect(
				store.deleteByProject(ctx(scope.ownerId), scope.secondaryProjectId)
			).resolves.toBeUndefined();
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

		if (publicListing) {
			it('listPublic keeps drafts and leaves out a non-public project', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				if (!scope.privateProjectId)
					throw new Error('publicListing requires scope.privateProjectId');
				const draft = makeUuid();
				const hidden = makeUuid();
				await store.create(ctx(scope.ownerId), record(scope, { guid: draft, status: 'draft' }));
				await store.create(
					ctx(scope.ownerId),
					record(scope, { guid: hidden, projectId: scope.privateProjectId })
				);

				const guids = (await store.listPublic(ctx(scope.ownerId))).items.map((r) => r.guid);
				expect(guids).toContain(draft);
				expect(guids).not.toContain(hidden);
			});
		}

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
			const outsiderPerms = { platformPermissions: [], orgPermissions: [] };

			it('ctx isolation: records created by one user are not visible to another', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const otherUser = scope.secondaryUserId;
				if (!otherUser) throw new Error('ctxIsolation requires scope.secondaryUserId');
				const guid = makeUuid();
				await store.create(
					ctx(scope.ownerId),
					record(scope, { guid, projectId: scope.privateProjectId ?? scope.projectId })
				);

				const page = await store.list(ctx(otherUser, outsiderPerms));
				expect(page.items.map((r) => r.guid)).not.toContain(guid);
			});

			it('ctx isolation: user cannot get a record they do not own', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const otherUser = scope.secondaryUserId;
				if (!otherUser) throw new Error('ctxIsolation requires scope.secondaryUserId');
				const guid = makeUuid();
				await store.create(
					ctx(scope.ownerId),
					record(scope, { guid, projectId: scope.privateProjectId ?? scope.projectId })
				);

				const got = await store.get(ctx(otherUser, outsiderPerms), guid);
				expect(got).toBeNull();
			});
		}
	});
}
