import { describe, beforeEach, it } from 'vitest';
import { runInviteStoreConformance } from '@selvajs/platform/testing';
import { DEFAULT_ORG_PERMISSIONS } from '@selvajs/platform';
import { SupabaseInviteStore } from '../SupabaseInviteStore.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseInviteStore (skipped: no live stack)', () => {
		it('populate packages/supabase-provider/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseInviteStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runInviteStoreConformance({
			name: 'SupabaseInviteStore',
			createStore: () => new SupabaseInviteStore(envCtx.bundle),
			createScope: async () => {
				const { userId: adminId, sessionToken: adminSessionToken } = await seedUser(envCtx, '');
				const orgId = crypto.randomUUID();
				const now = new Date().toISOString();
				await envCtx.adminClient.from('orgs').insert({
					id: orgId,
					name: 'Invite Test Org',
					slug: `invite-test-${orgId.slice(0, 8)}`,
					owner_id: adminId,
					created_at: now,
					updated_at: now
				});
				await envCtx.adminClient.from('org_members').insert({
					org_id: orgId,
					user_id: adminId,
					role: 'owner',
					permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
					joined_at: now
				});
				return { adminId, adminSessionToken, orgId };
			},
			seedUser: (id) => seedUser(envCtx, id)
		});
	});
}
