import { describe, beforeEach, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { runComputeServerStoreConformance } from '@selvajs/platform/testing';
import { SupabaseComputeServerStore } from '../SupabaseComputeServerStore.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

// A throwaway at-rest key so the store encrypts apiKeys during the suite. The
// round-trip (encrypt on write, decrypt on read) must be transparent to the
// conformance assertions, which compare plaintext apiKeys.
const TEST_SECRET_KEY = randomBytes(32);

if (!envCtx) {
	describe.skip('SupabaseComputeServerStore (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseComputeServerStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runComputeServerStoreConformance({
			name: 'SupabaseComputeServerStore',
			createStore: () => new SupabaseComputeServerStore(envCtx.bundle, TEST_SECRET_KEY),
			seedOrg: async (orgId) => {
				// `compute_servers.owner_org_id` and `compute_server_org_defaults.org_id`
				// FK to `orgs(id)`; the suite invents an `orgId` per org-scoped test,
				// so we materialize the parent org here. Owner is a throwaway user
				// (the org-scoped tests use SYSTEM_CONTEXT for writes anyway).
				const { userId } = await seedUser(envCtx, '');
				const now = new Date().toISOString();
				const { error } = await envCtx.adminClient.from('orgs').insert({
					id: orgId,
					name: 'Compute Test Org',
					slug: `compute-${orgId.slice(0, 8)}`,
					owner_id: userId,
					created_at: now,
					updated_at: now
				});
				if (error) throw error;
			}
		});
	});
}
