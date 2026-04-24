import { describe, beforeEach, it } from 'vitest';
import { runDefinitionStoreConformance } from '@selva/platform/testing';
import { DEFAULT_ORG_PERMISSIONS } from '@selva/platform';
import { SupabaseDefinitionStore } from '../SupabaseDefinitionStore.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseDefinitionStore (skipped: no live stack)', () => {
		it('populate packages/supabase-provider/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseDefinitionStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runDefinitionStoreConformance({
			name: 'SupabaseDefinitionStore',
			createStore: () => new SupabaseDefinitionStore(envCtx.bundle),
			createScope: async () => {
				// Seed: 1 owner + 1 secondary user + 1 org + 2 projects. Definitions
				// created in the suite FK to one of those two projects.
				const ownerId = await seedUser(envCtx, '');
				const secondaryUserId = await seedUser(envCtx, '');
				const orgId = crypto.randomUUID();
				const projectId = crypto.randomUUID();
				const secondaryProjectId = crypto.randomUUID();
				const now = new Date().toISOString();
				const admin = envCtx.adminClient;

				const { error: orgError } = await admin.from('orgs').insert({
					id: orgId,
					name: 'Definition Test Org',
					slug: `def-test-${orgId.slice(0, 8)}`,
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

				const { error: p1Error } = await admin.from('projects').insert([
					{
						id: projectId,
						org_id: orgId,
						name: 'Project A',
						slug: `proj-a-${projectId.slice(0, 8)}`,
						visibility: 'public',
						owner_id: ownerId,
						created_at: now,
						updated_at: now
					},
					{
						id: secondaryProjectId,
						org_id: orgId,
						name: 'Project B',
						slug: `proj-b-${secondaryProjectId.slice(0, 8)}`,
						visibility: 'public',
						owner_id: ownerId,
						created_at: now,
						updated_at: now
					}
				]);
				if (p1Error) throw p1Error;

				return { ownerId, projectId, secondaryProjectId, secondaryUserId };
			}
		});
	});
}
