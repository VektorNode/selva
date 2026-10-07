/**
 * Adapter conformance suite for IApiTokenStore.
 *
 * The rules adapters must honour:
 *
 * - `getByTokenHash` returns live tokens only. It is the resolver's sole read,
 *   so a revoked or expired row slipping through is a working credential.
 * - Read paths other than `getByTokenHash` never return `tokenHash`.
 * - Revoking keeps the row (marked), so audit events still resolve to a name.
 */

import { describe, it, expect } from 'vitest';
import type { IApiTokenStore } from '../../apiTokens/interface.js';
import type { ApiToken } from '../../apiTokens/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeSeedHelpers, makeUuid, noopSeedUser, type SeedUserFn } from './helpers.js';

export interface ApiTokenTestScope {
	/** Token owner. Must be seeded and a member of `orgId`. */
	ownerId: string;
	/** Access token for `ownerId`, for adapters with DB-side auth. */
	ownerSessionToken?: string;
	orgId: string;
	/** A second org, for cross-org isolation checks. The owner needn't belong to it. */
	otherOrgId: string;
}

export interface ApiTokenStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IApiTokenStore> | IApiTokenStore;
	createScope?: () => Promise<ApiTokenTestScope> | ApiTokenTestScope;
	seedUser?: SeedUserFn;
}

const DEFAULT_SCOPE: ApiTokenTestScope = {
	ownerId: 'owner-1',
	orgId: 'org-1',
	otherOrgId: 'org-2'
};

const DAY = 24 * 60 * 60 * 1000;

function token(scope: ApiTokenTestScope, overrides: Partial<ApiToken> = {}): ApiToken {
	const now = Date.now();
	return {
		id: makeUuid(),
		userId: scope.ownerId,
		createdBy: scope.ownerId,
		orgId: scope.orgId,
		name: 'conformance key',
		tokenHash: `hash-${makeUuid()}`,
		scopes: ['read:all'],
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + 30 * DAY).toISOString(),
		lastUsedAt: null,
		revokedAt: null,
		...overrides
	};
}

export function runApiTokenStoreConformance(opts: ApiTokenStoreConformanceOptions): void {
	const { name, createStore, createScope, seedUser = noopSeedUser } = opts;
	const { ctx, registerToken } = makeSeedHelpers(seedUser);
	const scopeFor = async (): Promise<ApiTokenTestScope> => {
		const s = createScope ? await createScope() : DEFAULT_SCOPE;
		if (s.ownerSessionToken) registerToken(s.ownerId, s.ownerSessionToken);
		return s;
	};

	describe(`IApiTokenStore conformance: ${name}`, () => {
		it('create + getByTokenHash round-trips', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const t = token(scope);
			await store.create(ctx(scope.ownerId), t);
			const got = await store.getByTokenHash(SYSTEM_CONTEXT, t.tokenHash);
			expect(got?.id).toBe(t.id);
			expect(got?.scopes).toEqual(['read:all']);
			expect(got?.userId).toBe(scope.ownerId);
		});

		it('getByTokenHash returns null for an unknown hash', async () => {
			const store = await createStore();
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, `nope-${makeUuid()}`)).toBeNull();
		});

		it('getByTokenHash returns null for an expired token', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const t = token(scope, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
			await store.create(ctx(scope.ownerId), t);
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, t.tokenHash)).toBeNull();
		});

		it('revoke stops resolution but keeps the row, marked', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const t = token(scope);
			await store.create(ctx(scope.ownerId), t);
			await store.revoke(ctx(scope.ownerId), t.id, 'owner');
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, t.tokenHash)).toBeNull();
			const row = await store.get(ctx(scope.ownerId), t.id);
			expect(row?.revokedAt).toBeTruthy();
		});

		it('revoke is idempotent and keeps the first revocation time', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const t = token(scope);
			await store.create(ctx(scope.ownerId), t);
			await store.revoke(ctx(scope.ownerId), t.id, 'owner');
			const first = (await store.get(ctx(scope.ownerId), t.id))?.revokedAt;
			await store.revoke(ctx(scope.ownerId), t.id, 'admin');
			expect((await store.get(ctx(scope.ownerId), t.id))?.revokedAt).toBe(first);
		});

		it('get and listByOrg never return tokenHash', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const t = token(scope);
			await store.create(ctx(scope.ownerId), t);
			const row = await store.get(ctx(scope.ownerId), t.id);
			expect(row).not.toBeNull();
			expect(row).not.toHaveProperty('tokenHash');
			const page = await store.listByOrg(ctx(scope.ownerId), scope.orgId, { limit: 100 });
			const listed = page.items.find((i) => i.id === t.id);
			expect(listed).toBeDefined();
			expect(listed).not.toHaveProperty('tokenHash');
		});

		it('listByOrg filters by org and, when given, by owner', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const { userId: otherUser } = await seedUser(makeUuid());
			const mine = token(scope);
			const theirs = token(scope, { userId: otherUser, createdBy: otherUser });
			const elsewhere = token(scope, { orgId: scope.otherOrgId });
			await store.create(ctx(scope.ownerId), mine);
			await store.create(SYSTEM_CONTEXT, theirs);
			await store.create(SYSTEM_CONTEXT, elsewhere);

			const all = await store.listByOrg(SYSTEM_CONTEXT, scope.orgId, { limit: 100 });
			const ids = all.items.map((i) => i.id);
			expect(ids).toContain(mine.id);
			expect(ids).toContain(theirs.id);
			expect(ids).not.toContain(elsewhere.id);

			const own = await store.listByOrg(SYSTEM_CONTEXT, scope.orgId, {
				limit: 100,
				userId: scope.ownerId
			});
			expect(own.items.map((i) => i.id)).toContain(mine.id);
			expect(own.items.map((i) => i.id)).not.toContain(theirs.id);
		});

		it('revokeAllForUser revokes one owner in one org and reports the ids', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const { userId: bystander } = await seedUser(makeUuid());
			const a = token(scope);
			const b = token(scope);
			const otherOrg = token(scope, { orgId: scope.otherOrgId });
			const someoneElse = token(scope, { userId: bystander, createdBy: bystander });
			for (const t of [a, b, otherOrg, someoneElse]) await store.create(SYSTEM_CONTEXT, t);

			const revoked = await store.revokeAllForUser(SYSTEM_CONTEXT, scope.ownerId, {
				orgId: scope.orgId,
				reason: 'member_removed'
			});
			expect(revoked.sort()).toEqual([a.id, b.id].sort());
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, a.tokenHash)).toBeNull();
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, otherOrg.tokenHash)).not.toBeNull();
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, someoneElse.tokenHash)).not.toBeNull();
		});

		it('revokeAllForUser without an org reaches every org', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const a = token(scope);
			const b = token(scope, { orgId: scope.otherOrgId });
			for (const t of [a, b]) await store.create(SYSTEM_CONTEXT, t);
			await store.revokeAllForUser(SYSTEM_CONTEXT, scope.ownerId, { reason: 'user_disabled' });
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, a.tokenHash)).toBeNull();
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, b.tokenHash)).toBeNull();
		});

		it('touchLastUsed records the time', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const t = token(scope);
			await store.create(ctx(scope.ownerId), t);
			const at = new Date().toISOString();
			await store.touchLastUsed(SYSTEM_CONTEXT, t.id, at);
			const row = await store.get(ctx(scope.ownerId), t.id);
			expect(Date.parse(row!.lastUsedAt!)).toBe(Date.parse(at));
		});

		it('eraseUser deletes their tokens and clears createdBy on ones they minted', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const { userId: other } = await seedUser(makeUuid());
			const owned = token(scope);
			const mintedForOther = token(scope, { userId: other, createdBy: scope.ownerId });
			for (const t of [owned, mintedForOther]) await store.create(SYSTEM_CONTEXT, t);

			await store.eraseUser(SYSTEM_CONTEXT, scope.ownerId);
			expect(await store.get(SYSTEM_CONTEXT, owned.id)).toBeNull();
			const kept = await store.get(SYSTEM_CONTEXT, mintedForOther.id);
			expect(kept?.createdBy).toBeNull();
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, mintedForOther.tokenHash)).not.toBeNull();
		});

		it('deleteByOrg removes only that org’s tokens', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const doomed = token(scope);
			const kept = token(scope, { orgId: scope.otherOrgId });
			for (const t of [doomed, kept]) await store.create(SYSTEM_CONTEXT, t);
			await store.deleteByOrg(SYSTEM_CONTEXT, scope.orgId);
			expect(await store.get(SYSTEM_CONTEXT, doomed.id)).toBeNull();
			expect(await store.get(SYSTEM_CONTEXT, kept.id)).not.toBeNull();
		});
	});
}
