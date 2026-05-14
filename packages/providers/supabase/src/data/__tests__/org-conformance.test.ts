import { describe, beforeEach, it } from 'vitest';
import { runOrgStoreConformance } from '@selvajs/platform/testing';
import { SupabaseOrgStore } from '../SupabaseOrgStore.js';
import { SupabaseInviteStore } from '../SupabaseInviteStore.js';
import { SupabaseComputeServerStore } from '../SupabaseComputeServerStore.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseOrgStore (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseOrgStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runOrgStoreConformance({
			name: 'SupabaseOrgStore',
			createStore: () => new SupabaseOrgStore(envCtx.bundle),
			seedUser: (id) => seedUser(envCtx, id),
			createCompanionStores: () => ({
				invites: new SupabaseInviteStore(envCtx.bundle),
				computeServer: new SupabaseComputeServerStore(envCtx.bundle)
			})
		});
	});
}
