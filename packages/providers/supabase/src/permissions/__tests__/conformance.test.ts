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
			},
			// Mirrors SupabaseAuthProvider.disableUser: a ban plus app_metadata.disabled via the
			// admin API, which sync_auth_user_disabled copies into user_profiles.disabled, the
			// column the store's invariant queries read.
			disableUser: async (userId) => {
				const admin = envCtx.bundle.serviceClient.auth.admin;
				const { data, error: fetchError } = await admin.getUserById(userId);
				if (fetchError || !data.user) throw fetchError ?? new Error('user not found');
				const { error } = await admin.updateUserById(userId, {
					ban_duration: '876000h',
					app_metadata: { ...(data.user.app_metadata ?? {}), disabled: true }
				});
				if (error) throw error;
			},
			strictDenials: true,
			refusesEscalation: true
		});
	});
}
