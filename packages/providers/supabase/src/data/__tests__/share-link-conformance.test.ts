import { describe, beforeEach, it } from 'vitest';
import { runShareLinkStoreConformance } from '@selvajs/platform/testing';
import { DEFAULT_ORG_PERMISSIONS } from '@selvajs/platform';
import { SupabaseShareLinkStore } from '../SupabaseShareLinkStore.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseShareLinkStore (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseShareLinkStore', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runShareLinkStoreConformance({
			name: 'SupabaseShareLinkStore',
			createStore: () => new SupabaseShareLinkStore(envCtx.bundle),
			createScope: async () => {
				// Seed: 1 owner + 1 org + 1 project + 2 definitions. Share links
				// FK to definitions, definitions FK to projects, projects FK to orgs.
				const { userId: ownerId, sessionToken: ownerSessionToken } = await seedUser(envCtx, '');
				const orgId = crypto.randomUUID();
				const projectId = crypto.randomUUID();
				const definitionId = crypto.randomUUID();
				const otherDefinitionId = crypto.randomUUID();
				const now = new Date().toISOString();
				const admin = envCtx.adminClient;

				const { error: orgError } = await admin.from('orgs').insert({
					id: orgId,
					name: 'Share Link Test Org',
					slug: `sl-test-${orgId.slice(0, 8)}`,
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
				const { error: projError } = await admin.from('projects').insert({
					id: projectId,
					org_id: orgId,
					name: 'Project',
					slug: `proj-${projectId.slice(0, 8)}`,
					visibility: 'public',
					owner_id: ownerId,
					created_at: now,
					updated_at: now
				});
				if (projError) throw projError;
				const { error: defError } = await admin.from('definitions').insert([
					{
						guid: definitionId,
						project_id: projectId,
						owner_id: ownerId,
						display_name: 'Def A',
						status: 'published',
						created_at: now,
						updated_at: now
					},
					{
						guid: otherDefinitionId,
						project_id: projectId,
						owner_id: ownerId,
						display_name: 'Def B',
						status: 'published',
						created_at: now,
						updated_at: now
					}
				]);
				if (defError) throw defError;

				// A second org the owner also leads, holding no links. Proves
				// `listByOrg` scopes by tenant rather than by "orgs I can read".
				const otherOrgId = crypto.randomUUID();
				const { error: otherOrgError } = await admin.from('orgs').insert({
					id: otherOrgId,
					name: 'Other Org',
					slug: `sl-other-${otherOrgId.slice(0, 8)}`,
					owner_id: ownerId,
					created_at: now,
					updated_at: now
				});
				if (otherOrgError) throw otherOrgError;
				const { error: otherMemberError } = await admin.from('org_members').insert({
					org_id: otherOrgId,
					user_id: ownerId,
					role: 'owner',
					permissions: [...DEFAULT_ORG_PERMISSIONS.owner],
					joined_at: now
				});
				if (otherMemberError) throw otherMemberError;

				return {
					ownerId,
					ownerSessionToken,
					definitionId,
					otherDefinitionId,
					orgId,
					otherOrgId
				};
			}
		});
	});
}
