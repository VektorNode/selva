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
 * - `markAccepted` succeeds once; a repeat returns false and changes nothing.
 * - `revoke` removes pending invites but must not un-consume accepted ones.
 * - `reopen`, where implemented, un-consumes only the acceptor's own claim.
 */

import { describe, it, expect } from 'vitest';
import type { IInviteStore } from '../../invites/interface.js';
import type { Invite } from '../../invites/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeSeedHelpers, makeUuid, noopSeedUser, randomSlug, type SeedUserFn } from './helpers.js';

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
	/** A second org, for the `orgScoping` cases. The admin needn't belong to it. */
	otherOrgId?: string;
}

export interface InviteStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IInviteStore> | IInviteStore;
	createScope?: () => Promise<InviteTestScope> | InviteTestScope;
	seedUser?: SeedUserFn;
	/** The default `ctx` holds no platform permissions, so no case passes on an `instance_admin` bypass. */
	nonAdminCtx?: boolean;
	/** `revoke` of an accepted invite is a no-op that leaves it on record as accepted. */
	revokeAccepted?: boolean;
	/**
	 * `listByOrg` leaves out another org's invites, and `deleteByOrg` removes only
	 * that org's. Needs `scope.otherOrgId` when `createScope` is supplied.
	 */
	orgScoping?: boolean;
	/** The store implements `reopen`. */
	reopen?: boolean;
}

function invite(scope: InviteTestScope, overrides: Partial<Invite> = {}): Invite {
	const now = new Date();
	return {
		id: overrides.id ?? makeUuid(),
		// Opaque to the store: it looks invites up by the digest it was given.
		tokenHash: overrides.tokenHash ?? `hash-${makeUuid()}`,
		email: overrides.email ?? `${randomSlug('invitee')}@test.local`,
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
	orgId: 'org-1',
	otherOrgId: 'org-2'
};

export function runInviteStoreConformance(opts: InviteStoreConformanceOptions): void {
	const {
		name,
		createStore,
		createScope,
		seedUser = noopSeedUser,
		nonAdminCtx = false,
		revokeAccepted = false,
		orgScoping = false,
		reopen = false
	} = opts;
	const { ctx, scopeFrom } = makeSeedHelpers(seedUser, { nonAdminCtx });
	const scopeFor = scopeFrom(createScope, DEFAULT_SCOPE, (s) => [
		{ userId: s.adminId, sessionToken: s.adminSessionToken }
	]);

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

		it('markAccepted consumes the invite once, and the first acceptor stays', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const { userId: acceptor } = await seedUser(makeUuid());
			const { userId: second } = await seedUser(makeUuid());
			const inv = invite(scope);
			await store.create(ctx(scope.adminId), inv);

			expect(await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor)).toBe(true);
			expect(await store.markAccepted(SYSTEM_CONTEXT, inv.id, second)).toBe(false);

			expect(await store.getByTokenHash(SYSTEM_CONTEXT, inv.tokenHash)).toBeNull();
			const page = await store.listByOrg(ctx(scope.adminId), scope.orgId, { limit: 100 });
			const row = page.items.find((i) => i.id === inv.id);
			expect(row?.acceptedAt).toBeTruthy();
			expect(row?.acceptedByUserId).toBe(acceptor);
		});

		it('listByOrg returns invites for the org', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const ids: string[] = [];
			for (let i = 0; i < 3; i++) {
				const inv = invite(scope);
				ids.push(inv.id);
				await store.create(ctx(scope.adminId), inv);
			}
			const page = await store.listByOrg(ctx(scope.adminId), scope.orgId, { limit: 100 });
			expect(page.items.map((i) => i.id)).toEqual(expect.arrayContaining(ids));
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

		it('revokePendingByEmail revokes every pending invite to that address, and no other', async () => {
			const store = await createStore();
			const scope = await scopeFor();
			const email = `offboard-${makeUuid()}@test.local`;
			const first = invite(scope, { email });
			const second = invite(scope, { email });
			const bystander = invite(scope, { email: `bystander-${makeUuid()}@test.local` });
			for (const inv of [first, second, bystander]) await store.create(ctx(scope.adminId), inv);

			const revoked = await store.revokePendingByEmail(ctx(scope.adminId), scope.orgId, email);
			expect(revoked.sort()).toEqual([first.id, second.id].sort());
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, first.tokenHash)).toBeNull();
			expect(await store.getByTokenHash(SYSTEM_CONTEXT, second.tokenHash)).toBeNull();
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

		if (reopen) {
			it('reopen by the acceptor makes the invite redeemable again', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const { userId: acceptor } = await seedUser(makeUuid());
				const inv = invite(scope);
				await store.create(ctx(scope.adminId), inv);
				await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);

				expect(await store.reopen!(SYSTEM_CONTEXT, inv.id, acceptor)).toBe(true);

				const got = await store.getByTokenHash(SYSTEM_CONTEXT, inv.tokenHash);
				expect(got?.acceptedAt).toBeUndefined();
				expect(got?.acceptedByUserId).toBeUndefined();
				expect(await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor)).toBe(true);
			});

			it('reopen refuses a pending invite, or one another user accepted', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const { userId: acceptor } = await seedUser(makeUuid());
				const { userId: other } = await seedUser(makeUuid());
				const inv = invite(scope);
				await store.create(ctx(scope.adminId), inv);

				expect(await store.reopen!(SYSTEM_CONTEXT, inv.id, acceptor)).toBe(false);
				await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);
				expect(await store.reopen!(SYSTEM_CONTEXT, inv.id, other)).toBe(false);
				expect(await store.getByTokenHash(SYSTEM_CONTEXT, inv.tokenHash)).toBeNull();
			});
		}

		if (revokeAccepted) {
			it('revoke of an accepted invite leaves it on record as accepted', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const { userId: acceptor } = await seedUser(makeUuid());
				const inv = invite(scope);
				await store.create(ctx(scope.adminId), inv);
				await store.markAccepted(SYSTEM_CONTEXT, inv.id, acceptor);

				await store.revoke(ctx(scope.adminId), inv.id);

				const page = await store.listByOrg(ctx(scope.adminId), scope.orgId, { limit: 100 });
				expect(page.items.find((i) => i.id === inv.id)?.acceptedByUserId).toBe(acceptor);
			});
		}

		if (orgScoping) {
			const otherOrgOf = (scope: InviteTestScope): string => {
				if (!scope.otherOrgId) throw new Error('orgScoping requires scope.otherOrgId');
				return scope.otherOrgId;
			};

			it('listByOrg leaves out another org’s invites', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const mine = invite(scope);
				const theirs = invite(scope, { orgId: otherOrgOf(scope) });
				await store.create(ctx(scope.adminId), mine);
				await store.create(SYSTEM_CONTEXT, theirs);

				const ids = (
					await store.listByOrg(ctx(scope.adminId), scope.orgId, { limit: 100 })
				).items.map((i) => i.id);
				expect(ids).toContain(mine.id);
				expect(ids).not.toContain(theirs.id);
			});

			it('deleteByOrg removes that org’s invites and no other', async () => {
				const store = await createStore();
				const scope = await scopeFor();
				const doomed = invite(scope);
				const kept = invite(scope, { orgId: otherOrgOf(scope) });
				await store.create(ctx(scope.adminId), doomed);
				await store.create(SYSTEM_CONTEXT, kept);

				await store.deleteByOrg(SYSTEM_CONTEXT, scope.orgId);

				expect(await store.getByTokenHash(SYSTEM_CONTEXT, doomed.tokenHash)).toBeNull();
				expect(await store.getByTokenHash(SYSTEM_CONTEXT, kept.tokenHash)).not.toBeNull();
			});
		}
	});
}
