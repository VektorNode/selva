/**
 * Adapter conformance suite for IInviteStore.
 *
 * Invites are the handoff between "admin wants to add Alice" and "Alice has
 * an account + an org membership". The contract is small but there are a few
 * state-machine rules adapters must honor:
 *
 * - `getByTokenHash` returns null for missing, expired, or already-consumed
 *   invites. The store sees only HMAC digests; the route layer hashes raw
 *   tokens before lookup.
 * - `markAccepted` is idempotent (no-op if already accepted).
 * - `revoke` removes pending invites but must not un-consume accepted ones.
 */

import { describe, it, expect } from 'vitest';
import type { IInviteStore } from '../../invites/interface.js';
import type { Invite } from '../../invites/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeSeedHelpers, makeUuid, noopSeedUser, type SeedUserFn } from './helpers.js';

export interface InviteTestScope {
	/** User that creates invites. Must be seeded + have `manage_org_members` in the org. */
	adminId: string;
	/**
	 * Optional access token for `adminId`. Required for adapters with DB-side
	 * auth (Supabase RLS); local providers ignore it.
	 */
	adminSessionToken?: string;
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
		// Conformance treats `tokenHash` as opaque — the suite stores whatever
		// the adapter receives and looks it up by the same value. The route
		// layer is the one that mints raw tokens and HMACs them; the store
		// contract is "lookup by stored digest".
		tokenHash:
			overrides.tokenHash ?? `hash-${makeUuid()}-${Math.random().toString(36).slice(2, 8)}`,
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

export function runInviteStoreConformance(opts: InviteStoreConformanceOptions): void {
	const { name, createStore, createScope, seedUser = noopSeedUser } = opts;
	const { ctx, registerToken } = makeSeedHelpers(seedUser);
	const scopeFor = async (): Promise<InviteTestScope> => {
		const s = createScope ? await createScope() : DEFAULT_SCOPE;
		if (s.adminSessionToken) registerToken(s.adminId, s.adminSessionToken);
		return s;
	};

	describe(`IInviteStore conformance: ${name}`, () => {
		it('create + getByTokenHash round-trips', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const inv = invite(scope);
			await store.create(ctx(scope.adminId), inv);
			const got = await store.getByTokenHash(SYSTEM_CONTEXT, inv.tokenHash);
			expect(got?.id).toBe(inv.id);
			expect(got?.email).toBe(inv.email);
		});

		it('getByTokenHash returns null for unknown hash', async () => {
			const store = await createStore();
			const got = await store.getByTokenHash(SYSTEM_CONTEXT, 'nope-' + makeUuid());
			expect(got).toBeNull();
		});

		it('getByTokenHash returns null for expired invite', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const inv = invite(scope, {
				expiresAt: new Date(Date.now() - 60_000).toISOString()
			});
			await store.create(ctx(scope.adminId), inv);
			const got = await store.getByTokenHash(SYSTEM_CONTEXT, inv.tokenHash);
			expect(got).toBeNull();
		});

		it('markAccepted sets acceptedAt + acceptedByUserId; getByTokenHash then returns null', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const { userId: acceptor } = await seedUser(makeUuid());
			const inv = invite(scope);
			await store.create(ctx(scope.adminId), inv);
			await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);
			const got = await store.getByTokenHash(SYSTEM_CONTEXT, inv.tokenHash);
			expect(got).toBeNull();
		});

		it('markAccepted is idempotent (second call is a no-op)', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const { userId: acceptor } = await seedUser(makeUuid());
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
			const got = await store.getByTokenHash(SYSTEM_CONTEXT, inv.tokenHash);
			expect(got).toBeNull();
		});

		it('revokePendingByEmail kills every pending invite to that address', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const email = `offboard-${makeUuid()}@test.local`;
			const first = invite(scope, { email });
			const second = invite(scope, { email });
			await store.create(ctx(scope.adminId), first);
			await store.create(ctx(scope.adminId), second);

			const revoked = await store.revokePendingByEmail(ctx(scope.adminId), scope.orgId, email);
			expect(revoked.sort()).toEqual([first.id, second.id].sort());
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, first.tokenHash)).toBeNull();
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, second.tokenHash)).toBeNull();
		});

		it('revokePendingByEmail leaves other addresses and other orgs alone', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const target = `target-${makeUuid()}@test.local`;
			const bystander = invite(scope, { email: `bystander-${makeUuid()}@test.local` });
			await store.create(ctx(scope.adminId), invite(scope, { email: target }));
			await store.create(ctx(scope.adminId), bystander);

			await store.revokePendingByEmail(ctx(scope.adminId), scope.orgId, target);
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, bystander.tokenHash)).not.toBeNull();
		});

		it('revokePendingByEmail does not un-consume an accepted invite', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const { userId: acceptor } = await seedUser(makeUuid());
			const email = `accepted-${makeUuid()}@test.local`;
			const inv = invite(scope, { email });
			await store.create(ctx(scope.adminId), inv);
			await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);

			// Accepting is history, not a live grant — offboarding must not erase
			// the record that this person once joined.
			const revoked = await store.revokePendingByEmail(ctx(scope.adminId), scope.orgId, email);
			expect(revoked).toEqual([]);
			const listed = await store.listByOrg(ctx(scope.adminId), scope.orgId, { limit: 100 });
			expect(listed.items.find((i) => i.id === inv.id)?.acceptedAt).toBeTruthy();
		});

		it('revokePendingByEmail matches case-insensitively', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const email = `mixed-${makeUuid()}@test.local`;
			const inv = invite(scope, { email });
			await store.create(ctx(scope.adminId), inv);

			const revoked = await store.revokePendingByEmail(
				ctx(scope.adminId),
				scope.orgId,
				email.toUpperCase()
			);
			expect(revoked).toEqual([inv.id]);
		});
	});
}
