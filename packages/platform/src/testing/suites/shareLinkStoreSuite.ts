/**
 * Adapter conformance suite for IShareLinkStore.
 *
 * Covers create + get + list, hash lookup, revocation semantics, and the
 * atomic check-and-increment that enforces the per-link cap. Adapters that
 * use real DB tables seed a parent definition through `createScope`; the
 * local adapter can stub.
 */

import { describe, it, expect } from 'vitest';
import type { IShareLinkStore } from '../../data/interface.js';
import type { ShareLink } from '../../shareLinks/types.js';
import { makeCtx, makeUuid } from './helpers.js';

const ctx = makeCtx;

export interface ShareLinkTestScope {
	/** Owner of the parent definition. Used as `createdBy`. */
	ownerId: string;
	/** Existing definition the conformance suite mints links against. */
	definitionId: string;
	/** A second definition id for cross-definition isolation tests. */
	otherDefinitionId: string;
}

export interface ShareLinkStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IShareLinkStore> | IShareLinkStore;
	/**
	 * Seed any parent rows the adapter requires (FK-enforced backends seed a
	 * `definitions` row + parent project). Local adapters can return stub ids.
	 */
	createScope?: () => Promise<ShareLinkTestScope> | ShareLinkTestScope;
}

const DEFAULT_SCOPE: ShareLinkTestScope = {
	ownerId: 'user-1',
	definitionId: 'def-1',
	otherDefinitionId: 'def-2'
};

function link(
	scope: ShareLinkTestScope,
	overrides: Partial<ShareLink> = {}
): ShareLink {
	const now = new Date().toISOString();
	return {
		id: overrides.id ?? makeUuid(),
		definitionId: overrides.definitionId ?? scope.definitionId,
		channel: overrides.channel ?? 'live',
		tokenHash: overrides.tokenHash ?? `hash-${makeUuid()}`,
		name: overrides.name,
		createdBy: overrides.createdBy ?? scope.ownerId,
		createdAt: overrides.createdAt ?? now,
		expiresAt: overrides.expiresAt ?? null,
		revokedAt: overrides.revokedAt ?? null,
		allowSolve: overrides.allowSolve ?? true,
		maxSolves: overrides.maxSolves === undefined ? null : overrides.maxSolves,
		solveCount: overrides.solveCount ?? 0
	};
}

export function runShareLinkStoreConformance(opts: ShareLinkStoreConformanceOptions): void {
	const { name, createStore, createScope } = opts;
	const scopeFor = async (): Promise<ShareLinkTestScope> =>
		createScope ? await createScope() : DEFAULT_SCOPE;

	describe(`IShareLinkStore conformance: ${name}`, () => {
		it('create + getById round-trips', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope);
			await store.create(ctx(scope.ownerId), l);
			const got = await store.getById(ctx(scope.ownerId), l.id);
			expect(got?.id).toBe(l.id);
			expect(got?.tokenHash).toBe(l.tokenHash);
			expect(got?.allowSolve).toBe(true);
		});

		it('listByDefinition returns links for that definition only, newest first', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const a = link(scope, { createdAt: '2026-04-01T00:00:00.000Z' });
			const b = link(scope, { createdAt: '2026-04-02T00:00:00.000Z' });
			const other = link(scope, { definitionId: scope.otherDefinitionId });
			await store.create(ctx(scope.ownerId), a);
			await store.create(ctx(scope.ownerId), b);
			await store.create(ctx(scope.ownerId), other);

			const page = await store.listByDefinition(ctx(scope.ownerId), scope.definitionId);
			expect(page.items.map((l) => l.id)).toEqual([b.id, a.id]);
		});

		it('getByTokenHash returns the matching link', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, { tokenHash: 'unique-hash' });
			await store.create(ctx(scope.ownerId), l);
			const got = await store.getByTokenHash(ctx(scope.ownerId), 'unique-hash');
			expect(got?.id).toBe(l.id);
		});

		it('getByTokenHash returns null for unknown hash', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const got = await store.getByTokenHash(ctx(scope.ownerId), 'nonexistent');
			expect(got).toBeNull();
		});

		it('revoke sets revokedAt; subsequent listByDefinition excludes it', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope);
			await store.create(ctx(scope.ownerId), l);
			await store.revoke(ctx(scope.ownerId), l.id);

			const page = await store.listByDefinition(ctx(scope.ownerId), scope.definitionId);
			expect(page.items.map((x) => x.id)).not.toContain(l.id);
		});

		it('revoke makes getByTokenHash return null', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, { tokenHash: 'will-revoke' });
			await store.create(ctx(scope.ownerId), l);
			await store.revoke(ctx(scope.ownerId), l.id);

			const got = await store.getByTokenHash(ctx(scope.ownerId), 'will-revoke');
			expect(got).toBeNull();
		});

		it('revoke is idempotent (no error on double-revoke)', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope);
			await store.create(ctx(scope.ownerId), l);
			await store.revoke(ctx(scope.ownerId), l.id);
			await store.revoke(ctx(scope.ownerId), l.id); // should not throw
		});

		it('tryIncrementSolveCount with null cap always increments', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, { maxSolves: null });
			await store.create(ctx(scope.ownerId), l);

			expect(await store.tryIncrementSolveCount(ctx(scope.ownerId), l.id)).toBe(1);
			expect(await store.tryIncrementSolveCount(ctx(scope.ownerId), l.id)).toBe(2);

			const after = await store.getById(ctx(scope.ownerId), l.id);
			expect(after?.solveCount).toBe(2);
		});

		it('tryIncrementSolveCount enforces a cap', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, { maxSolves: 2 });
			await store.create(ctx(scope.ownerId), l);

			expect(await store.tryIncrementSolveCount(ctx(scope.ownerId), l.id)).toBe(1);
			expect(await store.tryIncrementSolveCount(ctx(scope.ownerId), l.id)).toBe(2);
			expect(await store.tryIncrementSolveCount(ctx(scope.ownerId), l.id)).toBeNull();

			const after = await store.getById(ctx(scope.ownerId), l.id);
			expect(after?.solveCount).toBe(2);
		});

		it('tryIncrementSolveCount returns null for revoked links', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, { maxSolves: null });
			await store.create(ctx(scope.ownerId), l);
			await store.revoke(ctx(scope.ownerId), l.id);

			expect(await store.tryIncrementSolveCount(ctx(scope.ownerId), l.id)).toBeNull();
		});

		it('tryIncrementSolveCount returns null for unknown id', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			expect(await store.tryIncrementSolveCount(ctx(scope.ownerId), makeUuid())).toBeNull();
		});
	});
}
