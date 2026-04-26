import { describe, beforeEach, it } from 'vitest';
import { runComputeServerStoreConformance } from '@selvajs/platform/testing';
import { SupabaseComputeServerStore } from '../SupabaseComputeServerStore.js';
import { readEnv, resetAllData } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseComputeServerStore (skipped: no live stack)', () => {
		it('populate packages/supabase-provider/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseComputeServerStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runComputeServerStoreConformance({
			name: 'SupabaseComputeServerStore',
			createStore: () => new SupabaseComputeServerStore(envCtx.bundle)
		});
	});
}
