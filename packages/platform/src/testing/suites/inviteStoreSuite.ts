/**
 * Adapter conformance suite for IInviteStore.
 *
 * Invites are the handoff between "admin wants to add Alice" and "Alice has
 * an account + an org membership". The contract is small but there are a few
 * state-machine rules adapters must honor:
 *
 * - `getByToken` returns null for missing, expired, or already-consumed tokens.
 * - `markAccepted` is idempotent (no-op if already accepted).
 * - `revoke` removes pending invites but must not un-consume accepted ones.
 */

import { describe, it, expect } from 'vitest';
import type { IInviteStore } from '../../invites/interface.js';
import type { Invite } from '../../invites/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeCtx, makeUuid, noopSeedUser, type SeedUserFn } from './helpers.js';

export interface InviteTestScope {
	/** User that creates invites. Must be seeded + have `manage_org_members` in the org. */
	adminId: string;
	/** Org invites are issued for. Must be seeded with the admin as a member. */
	orgId: string;
}

export interface InviteStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IInviteStore> | IInviteStore;
	createScope?: () => Promise<InviteTestScope> | InviteTestScope;
	seedUser?: SeedUserFn;
}

function invite(scope: InviteTestScope, overrides: Partial<Invite> = {}): Invite {
	const now = new Date();
	return {
		id: overrides.id ?? makeUuid(),
		token: overrides.token ?? `tok-${makeUuid()}-${Math.random().toString(36).slice(2, 8)}`,
		email: overrides.email ?? `invitee-${Math.random().toString(36).slice(2, 6)}@test.local`,
		orgId: overrides.orgId ?? scope.orgId,
		orgRole: overrides.orgRole ?? 'member',
		orgPermissions: overrides.orgPermissions ?? [],
		invitedBy: overrides.invitedBy ?? scope.adminId,
		createdAt: overrides.createdAt ?? now.toISOString(),
		expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
		acceptedAt: overrides.acceptedAt,
		acceptedByUserId: overrides.acceptedByUserId
	};
}

const DEFAULT_SCOPE: InviteTestScope = {
	adminId: 'admin-1',
	orgId: 'org-1'
};

const ctx = makeCtx;

export function runInviteStoreConformance(opts: InviteStoreConformanceOptions): void {
	const { name, createStore, createScope, seedUser = noopSeedUser } = opts;
	const scopeFor = async (): Promise<InviteTestScope> =>
		createScope ? await createScope() : DEFAULT_SCOPE;

	describe(`IInviteStore conformance: ${name}`, () => {
		it('create + getByToken round-trips', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const inv = invite(scope);
			await store.create(ctx(scope.adminId), inv);
			const got = await store.getByToken(SYSTEM_CONTEXT, inv.token);
			expect(got?.id).toBe(inv.id);
			expect(got?.email).toBe(inv.email);
		});

		it('getByToken returns null for unknown token', async () => {
			const store = await createStore();
			const got = await store.getByToken(SYSTEM_CONTEXT, 'nope-' + makeUuid());
			expect(got).toBeNull();
		});

		it('getByToken returns null for expired invite', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const inv = invite(scope, {
				expiresAt: new Date(Date.now() - 60_000).toISOString()
			});
			await store.create(ctx(scope.adminId), inv);
			const got = await store.getByToken(SYSTEM_CONTEXT, inv.token);
			expect(got).toBeNull();
		});

		it('markAccepted sets acceptedAt + acceptedByUserId; getByToken then returns null', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const acceptor = await seedUser(makeUuid());
			const inv = invite(scope);
			await store.create(ctx(scope.adminId), inv);
			await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);
			const got = await store.getByToken(SYSTEM_CONTEXT, inv.token);
			expect(got).toBeNull();
		});

		it('markAccepted is idempotent (second call is a no-op)', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const acceptor = await seedUser(makeUuid());
			const inv = invite(scope);
			await store.create(ctx(scope.adminId), inv);
			await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);
			await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);
		});

		it('listByOrg returns invites for the org', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			for (let i = 0; i < 3; i++) await store.create(ctx(scope.adminId), invite(scope));
			const page = await store.listByOrg(ctx(scope.adminId), scope.orgId, { limit: 100 });
			expect(page.items.length).toBeGreaterThanOrEqual(3);
		});

		it('revoke removes a pending invite', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const inv = invite(scope);
			await store.create(ctx(scope.adminId), inv);
			await store.revoke(ctx(scope.adminId), inv.id);
			const got = await store.getByToken(SYSTEM_CONTEXT, inv.token);
			expect(got).toBeNull();
		});
	});
}
