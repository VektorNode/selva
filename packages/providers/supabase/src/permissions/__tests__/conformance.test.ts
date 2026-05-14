import { describe, beforeEach, it } from 'vitest';
import { runPlatformPermissionStoreConformance } from '@selvajs/platform/testing';
import { SupabasePlatformPermissionStore } from '../SupabasePlatformPermissionStore.js';
import { readEnv, resetAllData, seedPlainUser } from '../../data/__tests__/test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabasePlatformPermissionStore (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabasePlatformPermissionStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runPlatformPermissionStoreConformance({
			name: 'SupabasePlatformPermissionStore',
			createStore: async () => {
				return {
					store: new SupabasePlatformPermissionStore(envCtx.bundle),
					seedUser: async () => (await seedPlainUser(envCtx, '')).userId
				};
			}
		});
	});
}
