import { describe, beforeEach, it } from 'vitest';
import { runUserProfileStoreConformance } from '@selva/platform/testing';
import type { AuthUser } from '@selva/platform';
import { SupabaseUserProfileProvider } from '../SupabaseUserProfileProvider.js';
import { readEnv, resetAllData } from '../../data/__tests__/test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseUserProfileProvider (skipped: no live stack)', () => {
		it('populate packages/supabase-provider/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseUserProfileProvider', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runUserProfileStoreConformance({
			name: 'SupabaseUserProfileProvider',
			createStore: async () => {
				const store = new SupabaseUserProfileProvider(envCtx.bundle);
				const seedUser = async (email: string): Promise<AuthUser> => {
					const { data, error } = await envCtx.adminClient.auth.admin.createUser({
						email,
						password: 'conformance-test-password-1234',
						email_confirm: true
					});
					if (error) throw error;
					return {
						id: data.user.id,
						email: data.user.email,
						platformPermissions: []
					};
				};
				return { store, seedUser };
			}
		});
	});
}
