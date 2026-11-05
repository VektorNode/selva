import { describe, beforeEach, it } from 'vitest';
import { runApiTokenStoreConformance } from '@selvajs/platform/testing';
import { DEFAULT_ORG_PERMISSIONS } from '@selvajs/platform';
import { SupabaseApiTokenStore } from '../SupabaseApiTokenStore.js';
import {
	readEnv,
	resetAllData,
	seedPlainUser,
	seedUser,
	type TestContext
} from './test-helpers.js';

const envCtx = readEnv();

async function seedOrg(env: TestContext, ownerId: string, label: string): Promise<string> {
	const orgId = crypto.randomUUID();
	const now = new Date().toISOString();
	const org = await env.adminClient.from('orgs').insert({
		id: orgId,
		name: `${label} Org`,
		slug: `${label}-${orgId.slice(0, 8)}`,
		owner_id: ownerId,
		created_at: now,
		updated_at: now
	});
	if (org.error) throw org.error;
	return orgId;
}

if (!envCtx) {
	describe.skip('SupabaseApiTokenStore (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseApiTokenStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runApiTokenStoreConformance({
			name: 'SupabaseApiTokenStore',
			createStore: () => new SupabaseApiTokenStore(envCtx.bundle),
			createScope: async () => {
				// A plain member, so the owner-only policies are what's exercised.
				const { userId: ownerId, sessionToken: ownerSessionToken } = await seedPlainUser(
					envCtx,
					''
				);
				const orgId = await seedOrg(envCtx, ownerId, 'token');
				const otherOrgId = await seedOrg(envCtx, ownerId, 'token-other');
				const member = await envCtx.adminClient.from('org_members').insert({
					org_id: orgId,
					user_id: ownerId,
					role: 'member',
					permissions: [...DEFAULT_ORG_PERMISSIONS.member],
					joined_at: new Date().toISOString()
				});
				if (member.error) throw member.error;
				return { ownerId, ownerSessionToken, orgId, otherOrgId };
			},
			seedUser: (id) => seedUser(envCtx, id)
		});
	});
}
