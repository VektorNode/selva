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
		it('updateProfile changes displayName', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('p@example.com');
			const result = await store.updateProfile(user.id, { displayName: 'Felix' });
			expect(result).toBe('ok');
		});

		it('updateProfile returns not_found for unknown user', async () => {
			const { store } = await createStore();
			const result = await store.updateProfile('ghost', { displayName: 'X' });
			expect(result).toBe('not_found');
		});

		it('starDefinition + unstarDefinition round-trip', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('star@example.com');
			expect(await store.starDefinition(user.id, 'def-abc')).toBe('ok');
			expect(await store.unstarDefinition(user.id, 'def-abc')).toBe('ok');
		});

		it('starDefinition is idempotent (no duplicates)', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('idem@example.com');
			expect(await store.starDefinition(user.id, 'def-xyz')).toBe('ok');
			expect(await store.starDefinition(user.id, 'def-xyz')).toBe('ok');
		});

		it('recordRun returns ok for known user', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('runs@example.com');
			const run: RecentRun = {
				definitionId: 'def-1',
				runId: 'r1',
				definitionName: 'D',
				timestamp: new Date().toISOString()
			};
			expect(await store.recordRun(user.id, run)).toBe('ok');
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
