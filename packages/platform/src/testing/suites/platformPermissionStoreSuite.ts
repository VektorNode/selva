/**
 * Adapter conformance suite for IPlatformPermissionStore, including the
 * sole-`instance_admin` invariant: `set` returns `'last_admin'` rather than drop the
 * only admin, and `countInstanceAdminsExcluding` leaves out the named user.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { expectStatus, makeCtx, makeExpectDenied, makeShareCtx, makeSystemCtx } from './helpers.js';
import type { IPlatformPermissionStore, RequestContext } from '../../index.js';
import { ALL_PLATFORM_PERMISSIONS } from '../../index.js';

export interface PlatformPermissionStoreConformanceOptions {
	name: string;
	/**
	 * Build a fresh store and a `seedUser()` helper that creates a user the
	 * test can manage. Adapters with FK-enforced user IDs (Supabase) seed via
	 * the auth backend; local can return any uuid.
	 */
	createStore: () => Promise<{
		store: IPlatformPermissionStore;
		seedUser: () => Promise<string>;
	}>;
	/**
	 * Disable a user in the adapter's auth backend, in a way the store's admin
	 * counts observe: only enabled `instance_admin`s count. When present, the
	 * disabled-admin cases run; an adapter whose permission store can't see disabled
	 * state omits it, and those cases show as skipped rather than silently green.
	 */
	disableUser?: (userId: string) => Promise<void>;
	cleanup?: () => Promise<void> | void;
	/** Denials assert `ProviderError(403)`, not just a rejection. */
	strictDenials?: boolean;
	/**
	 * Run the escalation cases: a plain user granting themselves `instance_admin`,
	 * and a share-link context reading or setting permissions. Each must fail with 403.
	 */
	refusesEscalation?: boolean;
}

export function runPlatformPermissionStoreConformance(
	opts: PlatformPermissionStoreConformanceOptions
): void {
	const {
		name,
		createStore,
		disableUser,
		cleanup,
		strictDenials = false,
		refusesEscalation = false
	} = opts;
	const itWithDisable = disableUser ? it : it.skip;
	const expectDenied = makeExpectDenied(strictDenials);

	const adminCtx = (userId: string): RequestContext =>
		makeCtx(userId, { platformPermissions: [...ALL_PLATFORM_PERMISSIONS] });
	const selfCtx = (userId: string): RequestContext =>
		makeCtx(userId, { platformPermissions: [], orgPermissions: [] });
	/** The user-admin role: runs the user list, holds no `instance_admin`. */
	const userAdminCtx = (userId: string): RequestContext =>
		makeCtx(userId, { platformPermissions: ['manage_instance_users'], orgPermissions: [] });

	describe(`IPlatformPermissionStore conformance: ${name}`, () => {
		afterEach(async () => {
			if (cleanup) await cleanup();
		});

		it('getFor returns empty array for users with no grants', async () => {
			const { store, seedUser } = await createStore();
			const userId = await seedUser();
			const perms = await store.getFor(adminCtx(userId), userId);
			expect(perms).toEqual([]);
		});

		it('set then getFor round-trips every platform permission', async () => {
			const { store, seedUser } = await createStore();
			const userId = await seedUser();
			const all = ['manage_compute', 'manage_instance_users', 'manage_updates'] as const;
			const result = await store.set(adminCtx(userId), userId, [...all]);
			expect(result).toBe('ok');
			const fetched = await store.getFor(adminCtx(userId), userId);
			expect(fetched).toEqual(expect.arrayContaining([...all]));
		});

		it('set returns not_found for unknown user', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			// Random UUID that doesn't correspond to a real user
			const ghost = '00000000-0000-4000-8000-000000000000';
			const result = await store.set(adminCtx(adminId), ghost, ['instance_admin']);
			expect(result).toBe('not_found');
		});

		it('non-admin caller cannot set permissions for someone else', async () => {
			const { store, seedUser } = await createStore();
			const target = await seedUser();
			const attacker = await seedUser();
			await expectDenied(store.set(selfCtx(attacker), target, ['instance_admin']), 403);
		});

		it('non-admin caller cannot read another user’s permissions', async () => {
			const { store, seedUser } = await createStore();
			const target = await seedUser();
			const attacker = await seedUser();
			await expectDenied(store.getFor(selfCtx(attacker), target), 403);
		});

		it('user can read their own permissions', async () => {
			const { store, seedUser } = await createStore();
			const userId = await seedUser();
			const perms = await store.getFor(selfCtx(userId), userId);
			expect(perms).toEqual([]);
		});

		it('hasInstanceAdmin returns false on a fresh instance, true after granting', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			const sysCtx: RequestContext = makeSystemCtx();
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(false);
			await store.set(adminCtx(adminId), adminId, ['instance_admin']);
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(true);
		});

		it('set refuses to remove instance_admin from the sole admin', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			await store.set(adminCtx(adminId), adminId, ['instance_admin']);
			const result = await store.set(adminCtx(adminId), adminId, []);
			expect(result).toBe('last_admin');
			const after = await store.getFor(adminCtx(adminId), adminId);
			expect(after).toContain('instance_admin');
		});

		it('set allows demotion when another instance_admin exists', async () => {
			const { store, seedUser } = await createStore();
			const adminA = await seedUser();
			const adminB = await seedUser();
			await store.set(adminCtx(adminA), adminA, ['instance_admin']);
			await store.set(adminCtx(adminA), adminB, ['instance_admin']);
			const result = await store.set(adminCtx(adminA), adminA, []);
			expect(result).toBe('ok');
			// adminB still holds it
			const after = await store.getFor(adminCtx(adminA), adminB);
			expect(after).toContain('instance_admin');
		});

		// The invariant has to survive concurrency, not just sequence: two admins
		// demoting each other must not each read the other as the survivor.
		it('concurrent demotions of two admins leave one standing', async () => {
			const { store, seedUser } = await createStore();
			const adminA = await seedUser();
			const adminB = await seedUser();
			await store.set(adminCtx(adminA), adminA, ['instance_admin']);
			await store.set(adminCtx(adminA), adminB, ['instance_admin']);

			const [resA, resB] = await Promise.all([
				store.set(adminCtx(adminA), adminA, []),
				store.set(adminCtx(adminB), adminB, [])
			]);

			// One demotion succeeds, the other is refused — never both.
			expect([resA, resB].filter((r) => r === 'ok')).toHaveLength(1);
			expect([resA, resB].filter((r) => r === 'last_admin')).toHaveLength(1);

			const sysCtx: RequestContext = makeSystemCtx();
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(true);
		});

		it('a burst of concurrent demotions never drops the last admin', async () => {
			const { store, seedUser } = await createStore();
			// Seeded sequentially on purpose: concurrent seeding races the
			// adapter's own row-creation writes, which is not what this asserts.
			const ids: string[] = [];
			for (let i = 0; i < 4; i++) ids.push(await seedUser());
			for (const id of ids) await store.set(adminCtx(ids[0]), id, ['instance_admin']);

			const results = await Promise.all(ids.map((id) => store.set(adminCtx(id), id, [])));

			// Whatever the interleaving, exactly one admin survives.
			expect(results.filter((r) => r === 'ok')).toHaveLength(ids.length - 1);
			expect(results.filter((r) => r === 'last_admin')).toHaveLength(1);

			const sysCtx: RequestContext = makeSystemCtx();
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(true);
		});

		it('claimFirstInstanceAdmin grants on a fresh instance and refuses once claimed', async () => {
			const { store, seedUser } = await createStore();
			const first = await seedUser();
			const second = await seedUser();
			const sysCtx: RequestContext = makeSystemCtx();

			expect(await store.claimFirstInstanceAdmin(sysCtx, first, ['instance_admin'])).toBe(true);
			expect(await store.getFor(adminCtx(first), first)).toContain('instance_admin');

			// The instance is claimed. A later signer must not become a second
			// "first" admin, however they arrive.
			expect(await store.claimFirstInstanceAdmin(sysCtx, second, ['instance_admin'])).toBe(false);
			expect(await store.getFor(adminCtx(first), second)).not.toContain('instance_admin');
		});

		it('a burst of concurrent first-admin claims produces exactly one admin', async () => {
			const { store, seedUser } = await createStore();
			// First signer wins. With no bootstrap email configured every signer is
			// eligible, so this is four people hitting a fresh install at once; a
			// read-then-write claim grants all four.
			const ids: string[] = [];
			for (let i = 0; i < 4; i++) ids.push(await seedUser());
			const sysCtx: RequestContext = makeSystemCtx();

			const results = await Promise.all(
				ids.map((id) => store.claimFirstInstanceAdmin(sysCtx, id, ['instance_admin']))
			);

			expect(results.filter(Boolean)).toHaveLength(1);
			const admins = await store.getForBatch(adminCtx(ids[0]), ids);
			expect([...admins.values()].filter((p) => p.includes('instance_admin'))).toHaveLength(1);
		});

		it('countInstanceAdminsExcluding excludes the named user', async () => {
			const { store, seedUser } = await createStore();
			const adminA = await seedUser();
			const adminB = await seedUser();
			await store.set(adminCtx(adminA), adminA, ['instance_admin']);
			await store.set(adminCtx(adminA), adminB, ['instance_admin']);
			const sysCtx: RequestContext = makeSystemCtx();
			// Excluding adminA: one admin (adminB) remains
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminA)).toBe(1);
			// Excluding adminB: one admin (adminA) remains
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminB)).toBe(1);
		});

		it('countInstanceAdminsExcluding returns 0 when target is the sole admin', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			await store.set(adminCtx(adminId), adminId, ['instance_admin']);
			const sysCtx: RequestContext = makeSystemCtx();
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminId)).toBe(0);
		});

		itWithDisable('hasInstanceAdmin ignores disabled admins', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			const sysCtx: RequestContext = makeSystemCtx();
			await store.set(adminCtx(adminId), adminId, ['instance_admin']);
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(true);
			await disableUser!(adminId);
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(false);
		});

		itWithDisable('countInstanceAdminsExcluding ignores disabled admins', async () => {
			const { store, seedUser } = await createStore();
			const adminA = await seedUser();
			const adminB = await seedUser();
			await store.set(adminCtx(adminA), adminA, ['instance_admin']);
			await store.set(adminCtx(adminA), adminB, ['instance_admin']);
			const sysCtx: RequestContext = makeSystemCtx();
			await disableUser!(adminB);
			// adminB holds the grant but is disabled — must not count as the
			// "other admin" that would allow demoting/disabling adminA.
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminA)).toBe(0);
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminB)).toBe(1);
		});

		it('getForBatch returns a map keyed by userId', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			const memberId = await seedUser();
			await store.set(adminCtx(adminId), adminId, ['instance_admin']);
			await store.set(adminCtx(adminId), memberId, ['manage_compute']);
			const map = await store.getForBatch(adminCtx(adminId), [adminId, memberId]);
			expect(map.get(adminId)).toContain('instance_admin');
			expect(map.get(memberId)).toContain('manage_compute');
		});

		it('getForBatch from a non-admin caller is rejected', async () => {
			const { store, seedUser } = await createStore();
			const attacker = await seedUser();
			const target = await seedUser();
			await expectDenied(store.getForBatch(selfCtx(attacker), [target]), 403);
		});

		// `manage_instance_users` runs the user-admin surface, so it must see who holds
		// `instance_admin`, or that page can't render its locks. Read access is not
		// authority: the `set` case below keeps the two apart.
		it('manage_instance_users can batch-read platform permissions', async () => {
			const { store, seedUser } = await createStore();
			const admin = await seedUser();
			const userAdmin = await seedUser();
			await store.set(adminCtx(admin), admin, ['instance_admin']);

			const map = await store.getForBatch(userAdminCtx(userAdmin), [admin, userAdmin]);
			expect(map.get(admin)).toContain('instance_admin');
		});

		it('manage_instance_users can read another user’s permissions singly', async () => {
			const { store, seedUser } = await createStore();
			const admin = await seedUser();
			const userAdmin = await seedUser();
			await store.set(adminCtx(admin), admin, ['instance_admin']);

			// Single and batch reads must agree.
			expect(await store.getFor(userAdminCtx(userAdmin), admin)).toContain('instance_admin');
		});

		it('manage_instance_users cannot grant permissions', async () => {
			const { store, seedUser } = await createStore();
			const target = await seedUser();
			const userAdmin = await seedUser();
			await expectDenied(store.set(userAdminCtx(userAdmin), target, ['instance_admin']), 403);
		});

		if (refusesEscalation) {
			it('a plain user cannot grant themselves instance_admin', async () => {
				const { store, seedUser } = await createStore();
				const admin = await seedUser();
				const user = await seedUser();
				await store.set(adminCtx(admin), admin, ['instance_admin']);

				await expectStatus(store.set(selfCtx(user), user, ['instance_admin']), 403);
				expect(await store.getFor(adminCtx(admin), user)).not.toContain('instance_admin');
			});

			it('a share-link context can neither read nor set permissions', async () => {
				const { store, seedUser } = await createStore();
				const user = await seedUser();
				const share = makeShareCtx();

				await expectStatus(store.set(share, user, ['instance_admin']), 403);
				await expectStatus(store.getFor(share, user), 403);
				await expectStatus(store.getForBatch(share, [user]), 403);
			});
		}
	});
}
