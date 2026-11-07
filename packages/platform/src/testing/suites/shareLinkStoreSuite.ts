/**
 * Adapter conformance suite for IShareLinkStore.
 *
 * Covers create + get + list, hash lookup, revocation semantics, and the
 * atomic check-and-increment that enforces the per-link cap. Adapters that
 * use real DB tables seed a parent definition through `createScope`; the
 * local adapter can stub.
 */

import { describe, it, expect } from 'vitest';
import type { IShareLinkStore } from '../../shareLinks/interface.js';
import type { ShareLink } from '../../shareLinks/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeSeedHelpers, makeUuid, nextTick, noopSeedUser } from './helpers.js';

export interface ShareLinkTestScope {
	/** Owner of the parent definition. Used as `createdBy`. */
	ownerId: string;
	/**
	 * Optional access token for `ownerId`. Required for adapters with DB-side
	 * auth (Supabase RLS); local providers ignore it.
	 */
	ownerSessionToken?: string;
	/** Existing definition the conformance suite mints links against. */
	definitionId: string;
	/** A second definition id for cross-definition isolation tests. */
	otherDefinitionId: string;
	/**
	 * Org owning both definitions' project. Set it to run the `listByOrg`
	 * cases; adapters that can't seed the definition→project→org chain leave it
	 * undefined and those cases skip.
	 */
	orgId?: string;
	/** An org with no share links, to prove the roster is tenant-scoped. */
	otherOrgId?: string;
}

export interface ShareLinkStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IShareLinkStore> | IShareLinkStore;
	/**
	 * Seed any parent rows the adapter requires (FK-enforced backends seed a
	 * `definitions` row + parent project). Local adapters can return stub ids.
	 */
	createScope?: () => Promise<ShareLinkTestScope> | ShareLinkTestScope;
	/** The scope seeds `orgId` and `otherOrgId`, so the `listByOrg` cases can run. */
	orgRoster?: boolean;
	/** The default `ctx` holds no platform permissions, so no case passes on an `instance_admin` bypass. */
	nonAdminCtx?: boolean;
	/**
	 * `getById` still returns a revoked or expired link, and a second `revoke` keeps
	 * the first `revokedAt`.
	 */
	revocationState?: boolean;
}

const DEFAULT_SCOPE: ShareLinkTestScope = {
	ownerId: 'user-1',
	definitionId: 'def-1',
	otherDefinitionId: 'def-2'
};

function link(scope: ShareLinkTestScope, overrides: Partial<ShareLink> = {}): ShareLink {
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
	const {
		name,
		createStore,
		createScope,
		orgRoster = false,
		nonAdminCtx = false,
		revocationState = false
	} = opts;
	const { ctx, scopeFrom } = makeSeedHelpers(noopSeedUser, { nonAdminCtx });
	const scopeFor = scopeFrom(createScope, DEFAULT_SCOPE, (s) => [
		{ userId: s.ownerId, sessionToken: s.ownerSessionToken }
	]);

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

		it('a revoked link leaves listByDefinition and stops resolving by token', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, { tokenHash: 'will-revoke' });
			await store.create(ctx(scope.ownerId), l);
			await store.revoke(ctx(scope.ownerId), l.id);

			const page = await store.listByDefinition(ctx(scope.ownerId), scope.definitionId);
			expect(page.items.map((x) => x.id)).not.toContain(l.id);
			expect(await store.getByTokenHash(ctx(scope.ownerId), 'will-revoke')).toBeNull();
		});

		// Expiry is a store-level filter, not only a route-level check.
		it('an expired link leaves listByDefinition and stops resolving by token', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, {
				tokenHash: 'already-expired',
				expiresAt: new Date(Date.now() - 60_000).toISOString()
			});
			await store.create(ctx(scope.ownerId), l);

			const page = await store.listByDefinition(ctx(scope.ownerId), scope.definitionId);
			expect(page.items.map((x) => x.id)).not.toContain(l.id);
			expect(await store.getByTokenHash(ctx(scope.ownerId), 'already-expired')).toBeNull();
		});

		it('a link expiring in the future still resolves', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, {
				tokenHash: 'not-yet-expired',
				expiresAt: new Date(Date.now() + 600_000).toISOString()
			});
			await store.create(ctx(scope.ownerId), l);

			const got = await store.getByTokenHash(ctx(scope.ownerId), 'not-yet-expired');
			expect(got?.id).toBe(l.id);
		});

		// The org roster is the only read that answers "what reaches this tenant's
		// data right now?". `skipIf` rather than an omitted block, so an adapter that
		// doesn't seed an org shows as skipped instead of silently covering nothing.
		describe.skipIf(!orgRoster)('listByOrg', () => {
			it('returns links across every definition in the org, newest first', async () => {
				const scope = await scopeFor();
				const store = await createStore();
				const a = link(scope, { createdAt: '2026-04-01T00:00:00.000Z' });
				const b = link(scope, {
					definitionId: scope.otherDefinitionId,
					createdAt: '2026-04-02T00:00:00.000Z'
				});
				await store.create(ctx(scope.ownerId), a);
				await store.create(ctx(scope.ownerId), b);

				const page = await store.listByOrg(ctx(scope.ownerId), scope.orgId!, { limit: 100 });
				expect(page.items.map((l) => l.id)).toEqual([b.id, a.id]);
			});

			it('names the parent definition and project on every row', async () => {
				const scope = await scopeFor();
				const store = await createStore();
				const l = link(scope);
				await store.create(ctx(scope.ownerId), l);

				const page = await store.listByOrg(ctx(scope.ownerId), scope.orgId!, { limit: 100 });
				const row = page.items.find((x) => x.id === l.id);
				// A roster of bare GUIDs can't be acted on — revoking the wrong link
				// is unrecoverable.
				expect(row?.definitionName).toBeTruthy();
				expect(row?.projectName).toBeTruthy();
				expect(row?.projectId).toBeTruthy();
			});

			it('never carries tokenHash — the roster spans the whole tenant', async () => {
				const scope = await scopeFor();
				const store = await createStore();
				await store.create(ctx(scope.ownerId), link(scope));

				const page = await store.listByOrg(ctx(scope.ownerId), scope.orgId!, { limit: 100 });
				expect(page.items.length).toBeGreaterThan(0);
				for (const row of page.items) {
					expect(row).not.toHaveProperty('tokenHash');
				}
			});

			it('excludes revoked and expired links', async () => {
				const scope = await scopeFor();
				const store = await createStore();
				const revoked = link(scope);
				const expired = link(scope, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
				const live = link(scope);
				await store.create(ctx(scope.ownerId), revoked);
				await store.create(ctx(scope.ownerId), expired);
				await store.create(ctx(scope.ownerId), live);
				await store.revoke(ctx(scope.ownerId), revoked.id);

				const page = await store.listByOrg(ctx(scope.ownerId), scope.orgId!, { limit: 100 });
				const ids = page.items.map((x) => x.id);
				expect(ids).toContain(live.id);
				expect(ids).not.toContain(revoked.id);
				expect(ids).not.toContain(expired.id);
			});

			it('does not leak links into another org', async () => {
				const scope = await scopeFor();
				if (!scope.otherOrgId) throw new Error('orgRoster requires scope.otherOrgId');
				const store = await createStore();
				await store.create(ctx(scope.ownerId), link(scope));

				const page = await store.listByOrg(ctx(scope.ownerId), scope.otherOrgId, { limit: 100 });
				expect(page.items).toHaveLength(0);
			});
		});

		it('tryIncrementSolveCount holds the cap under concurrent solves', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope, { maxSolves: 5 });
			await store.create(ctx(scope.ownerId), l);

			const results = await Promise.all(
				Array.from({ length: 20 }, () => store.tryIncrementSolveCount(SYSTEM_CONTEXT, l.id))
			);

			expect(results.filter((n) => n !== null)).toHaveLength(5);
			expect((await store.getById(ctx(scope.ownerId), l.id))?.solveCount).toBe(5);
		});

		it('revoke is idempotent (no error on double-revoke)', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const l = link(scope);
			await store.create(ctx(scope.ownerId), l);
			await store.revoke(ctx(scope.ownerId), l.id);
			await store.revoke(ctx(scope.ownerId), l.id); // should not throw
		});

		if (revocationState) {
			it('getById still returns a revoked link, and a second revoke keeps the first revokedAt', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const l = link(scope);
				await store.create(ctx(scope.ownerId), l);
				await store.revoke(ctx(scope.ownerId), l.id);
				const first = (await store.getById(ctx(scope.ownerId), l.id))?.revokedAt;
				expect(first).toBeTruthy();

				await nextTick();
				await store.revoke(ctx(scope.ownerId), l.id);
				expect((await store.getById(ctx(scope.ownerId), l.id))?.revokedAt).toBe(first);
			});

			it('getById still returns an expired link', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const l = link(scope, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
				await store.create(ctx(scope.ownerId), l);

				expect((await store.getById(ctx(scope.ownerId), l.id))?.id).toBe(l.id);
			});
		}

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
