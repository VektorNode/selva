/**
 * Adapter conformance suite for IPlatformPermissionStore.
 *
 * Covers `getFor` / `getForBatch` / `set` / `hasInstanceAdmin` /
 * `countInstanceAdminsExcluding`, plus the §2 sole-`instance_admin`
 * invariant — `set` must return `'last_admin'` when dropping the only admin,
 * and `countInstanceAdminsExcluding` must exclude the named user.
 *
 * These tests used to live on the auth-provider conformance suite when the
 * invariant was enforced there; the move from `IAuthProvider` to
 * `IPlatformPermissionStore` brought them with it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IPlatformPermissionStore, RequestContext } from '../../index.js';
import { ALL_ORG_PERMISSIONS, ALL_PLATFORM_PERMISSIONS } from '../../index.js';

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
	 * Optional: disable a user in the adapter's auth backend, in a way the
	 * store's enabled-admin invariant queries observe. When present, the
	 * disabled-admin exclusion tests run (docs/contributing/permissions.md §10 counts only
	 * *enabled* instance_admins). Adapters whose permission store can't see
	 * disabled state (local — documented boundary) omit it; the tests then
	 * show as skipped rather than silently green.
	 */
	disableUser?: (userId: string) => Promise<void>;
	cleanup?: () => Promise<void> | void;
}

export function runPlatformPermissionStoreConformance(
	opts: PlatformPermissionStoreConformanceOptions
): void {
	const { name, createStore, disableUser, cleanup } = opts;
	const itWithDisable = disableUser ? it : it.skip;

	function adminCtx(userId: string): RequestContext {
		return {
			userId,
			platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
			orgPermissions: [...ALL_ORG_PERMISSIONS]
		};
	}

	function selfCtx(userId: string): RequestContext {
		return {
			userId,
			platformPermissions: [],
			orgPermissions: []
		};
	}

	describe(`IPlatformPermissionStore conformance: ${name}`, () => {
		beforeEach(() => {
			// Every test creates its own store via createStore — no shared state.
		});

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
			await expect(store.set(selfCtx(attacker), target, ['instance_admin'])).rejects.toThrow();
		});

		it('non-admin caller cannot read another user’s permissions', async () => {
			const { store, seedUser } = await createStore();
			const target = await seedUser();
			const attacker = await seedUser();
			await expect(store.getFor(selfCtx(attacker), target)).rejects.toThrow();
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
			const sysCtx: RequestContext = {
				userId: '',
				platformPermissions: [],
				orgPermissions: [],
				system: true
			};
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(false);
			await store.set(adminCtx(adminId), adminId, ['instance_admin']);
			expect(await store.hasInstanceAdmin(sysCtx)).toBe(true);
		});

		// §2 invariant — the load-bearing test.
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

		it('countInstanceAdminsExcluding excludes the named user', async () => {
			const { store, seedUser } = await createStore();
			const adminA = await seedUser();
			const adminB = await seedUser();
			await store.set(adminCtx(adminA), adminA, ['instance_admin']);
			await store.set(adminCtx(adminA), adminB, ['instance_admin']);
			const sysCtx: RequestContext = {
				userId: '',
				platformPermissions: [],
				orgPermissions: [],
				system: true
			};
			// Excluding adminA: one admin (adminB) remains
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminA)).toBe(1);
			// Excluding adminB: one admin (adminA) remains
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminB)).toBe(1);
		});

		it('countInstanceAdminsExcluding returns 0 when target is the sole admin', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			await store.set(adminCtx(adminId), adminId, ['instance_admin']);
			const sysCtx: RequestContext = {
				userId: '',
				platformPermissions: [],
				orgPermissions: [],
				system: true
			};
			expect(await store.countInstanceAdminsExcluding(sysCtx, adminId)).toBe(0);
		});

		itWithDisable('hasInstanceAdmin ignores disabled admins', async () => {
			const { store, seedUser } = await createStore();
			const adminId = await seedUser();
			const sysCtx: RequestContext = {
				userId: '',
				platformPermissions: [],
				orgPermissions: [],
				system: true
			};
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
			const sysCtx: RequestContext = {
				userId: '',
				platformPermissions: [],
				orgPermissions: [],
				system: true
			};
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
			await expect(store.getForBatch(selfCtx(attacker), [target])).rejects.toThrow();
		});
	});
}
