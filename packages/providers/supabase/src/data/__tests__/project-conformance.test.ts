import { describe, beforeEach, it } from 'vitest';
import { runProjectStoreConformance } from '@selvajs/platform/testing';
import { DEFAULT_ORG_PERMISSIONS } from '@selvajs/platform';
import { SupabaseProjectStore } from '../SupabaseProjectStore.js';
import {
	readEnv,
	resetAllData,
	seedPlainUser,
	seedUser,
	type TestContext
} from './test-helpers.js';

const envCtx = readEnv();

/**
 * An org owned by `ownerId`, with the owner membership carrying `manage_projects`
 * so project creates pass the `has_org_permission` policy under RLS.
 */
async function seedOrg(env: TestContext, ownerId: string): Promise<string> {
	const admin = env.adminClient;
	const orgId = crypto.randomUUID();
	const now = new Date().toISOString();
	const { error: orgError } = await admin.from('orgs').insert({
		id: orgId,
		name: `Conformance Org ${orgId.slice(0, 8)}`,
		slug: `conformance-${orgId.slice(0, 8)}`,
		owner_id: ownerId,
		created_at: now,
		updated_at: now
	});
	if (orgError) throw orgError;
	const { error: memberError } = await admin.from('org_members').insert({
		org_id: orgId,
		user_id: ownerId,
		role: 'owner',
		permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
		joined_at: now
	});
	if (memberError) throw memberError;
	return orgId;
}

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
				const { userId: ownerId, sessionToken: ownerSessionToken } = await seedUser(envCtx, '');
				const orgId = await seedOrg(envCtx, ownerId);
				const otherOrgId = await seedOrg(envCtx, ownerId);
				return {
					store: new SupabaseProjectStore(envCtx.bundle),
					orgId,
					otherOrgId,
					ownerId,
					ownerSessionToken
				};
			},
			seedUser: (id) => seedUser(envCtx, id),
			seedOutsider: (id) => seedPlainUser(envCtx, id),
			ctxIsolation: true,
			strictDenials: true,
			auditStamps: true,
			orgScoping: true
		});
	});
}
