/**
 * Adapter conformance suite for IUserProfileStore.
 *
 * Tests the user-profile mutations (display name, starred definitions,
 * recent runs) that used to live on IAuthProvider. Adapters must seed
 * a real user before each test since profile mutations target a userId.
 */

import { describe, it, expect } from 'vitest';
import type { IUserProfileStore } from '../../userProfile/interface.js';
import type { AuthUser, RecentRun } from '../../auth/index.js';

export interface UserProfileStoreConformanceOptions {
	/** Name to show in test output. */
	name: string;
	/**
	 * Factory that returns a fresh, empty store and a `seedUser(email)` helper
	 * that creates a real user the test can mutate. The helper is provider-
	 * specific because IUserProfileStore itself doesn't create users.
	 */
	createStore: () => Promise<{
		store: IUserProfileStore;
		seedUser: (email: string) => Promise<AuthUser>;
	}>;
}

export function runUserProfileStoreConformance(opts: UserProfileStoreConformanceOptions): void {
	const { name, createStore } = opts;

	describe(`IUserProfileStore conformance: ${name}`, () => {
		it('getProfile returns null for unknown user', async () => {
			const { store } = await createStore();
			const profile = await store.getProfile('ghost');
			expect(profile).toBeNull();
		});

		it('getProfile returns a profile for a seeded user', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('get@example.com');
			const profile = await store.getProfile(user.id);
			expect(profile).toBeTruthy();
			expect(profile?.userId).toBe(user.id);
			expect(profile?.starredDefinitions).toEqual([]);
			expect(profile?.recentRuns).toEqual([]);
		});

		it('getProfiles batch-loads seeded users and skips unknowns', async () => {
			const { store, seedUser } = await createStore();
			const a = await seedUser('a-batch@example.com');
			const b = await seedUser('b-batch@example.com');
			const profiles = await store.getProfiles([a.id, b.id, 'ghost']);
			const ids = new Set(profiles.map((p) => p.userId));
			expect(ids.has(a.id)).toBe(true);
			expect(ids.has(b.id)).toBe(true);
			expect(ids.has('ghost')).toBe(false);
		});

		it('updateProfile changes displayName and getProfile returns it', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('p@example.com');
			const result = await store.updateProfile(user.id, { displayName: 'Felix' });
			expect(result).toBe('ok');
			const profile = await store.getProfile(user.id);
			expect(profile?.displayName).toBe('Felix');
		});

		it('updateProfile returns not_found for unknown user', async () => {
			const { store } = await createStore();
			const result = await store.updateProfile('ghost', { displayName: 'X' });
			expect(result).toBe('not_found');
		});

		it('starDefinition + unstarDefinition round-trip reflects in profile', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('star@example.com');
			expect(await store.starDefinition(user.id, 'def-abc')).toBe('ok');
			expect((await store.getProfile(user.id))?.starredDefinitions).toContain('def-abc');
			expect(await store.unstarDefinition(user.id, 'def-abc')).toBe('ok');
			expect((await store.getProfile(user.id))?.starredDefinitions).not.toContain('def-abc');
		});

		it('starDefinition is idempotent (no duplicates)', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('idem@example.com');
			expect(await store.starDefinition(user.id, 'def-xyz')).toBe('ok');
			expect(await store.starDefinition(user.id, 'def-xyz')).toBe('ok');
		});

		it('recordRun returns ok and profile surfaces the entry', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('runs@example.com');
			const run: RecentRun = {
				definitionId: 'def-1',
				runId: 'r1',
				definitionName: 'D',
				timestamp: new Date().toISOString()
			};
			expect(await store.recordRun(user.id, run)).toBe('ok');
			const profile = await store.getProfile(user.id);
			expect(profile?.recentRuns.some((r) => r.runId === 'r1')).toBe(true);
		});

		it('recordRun returns not_found for unknown user', async () => {
			const { store } = await createStore();
			const run: RecentRun = {
				definitionId: 'def-1',
				runId: 'r1',
				definitionName: 'D',
				timestamp: new Date().toISOString()
			};
			expect(await store.recordRun('ghost', run)).toBe('not_found');
		});

		it('starDefinition returns not_found for unknown user', async () => {
			const { store } = await createStore();
			expect(await store.starDefinition('ghost', 'def-1')).toBe('not_found');
		});
	});
}
