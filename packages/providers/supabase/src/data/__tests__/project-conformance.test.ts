import { describe, beforeEach, it } from 'vitest';
import { runProjectStoreConformance } from '@selvajs/platform/testing';
import { DEFAULT_ORG_PERMISSIONS } from '@selvajs/platform';
import { SupabaseProjectStore } from '../SupabaseProjectStore.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseProjectStore (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseProjectStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runProjectStoreConformance({
			name: 'SupabaseProjectStore',
			createStore: async () => {
				// Seed an owner + an org so the project tests have an anchor.
				const { userId: ownerId, sessionToken: ownerSessionToken } = await seedUser(envCtx, '');
				const orgId = crypto.randomUUID();
				const now = new Date().toISOString();
				const admin = envCtx.adminClient;
				const { error: orgError } = await admin.from('orgs').insert({
					id: orgId,
					name: 'Conformance Org',
					slug: `conformance-${orgId.slice(0, 8)}`,
					owner_id: ownerId,
					created_at: now,
					updated_at: now
				});
				if (orgError) throw orgError;
				// And an owner membership with `manage_projects` so project
				// creates pass the `has_org_permission` policy under RLS.
				const { error: memberError } = await admin.from('org_members').insert({
					org_id: orgId,
					user_id: ownerId,
					role: 'owner',
					permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
					joined_at: now
				});
				if (memberError) throw memberError;

				return {
					store: new SupabaseProjectStore(envCtx.bundle),
					orgId,
					ownerId,
					ownerSessionToken
				};
			},
			seedUser: (id) => seedUser(envCtx, id)
		});
	});
}
