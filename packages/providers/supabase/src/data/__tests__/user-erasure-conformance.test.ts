import { beforeEach, describe, it } from 'vitest';
import { runUserErasureConformance } from '@selvajs/platform/testing';
import { SupabaseDataProvider } from '../SupabaseDataProvider.js';
import { readEnv, resetAllData, seedPlainUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseDataProvider erasure (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseDataProvider erasure', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runUserErasureConformance({
			name: 'SupabaseDataProvider',
			createProvider: () => SupabaseDataProvider.fromBundle(envCtx.bundle),
			seedUser: (id) => seedPlainUser(envCtx, id),
			deleteIdentity: async (userId) => {
				const { error } = await envCtx.adminClient.auth.admin.deleteUser(userId);
				if (error) throw error;
			}
		});
	});
}
