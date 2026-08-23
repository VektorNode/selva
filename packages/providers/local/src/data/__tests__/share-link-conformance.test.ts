import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runShareLinkStoreConformance } from '@selvajs/platform/testing';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { LocalDataProvider } from '../LocalDataProvider.js';

// The compute-server store demands one; nothing in this suite encrypts anything.
const AT_REST_KEY = '0'.repeat(64);

describe('LocalShareLinkStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-share-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runShareLinkStoreConformance({
		name: 'LocalShareLinkStore',
		// Built through the real composition root rather than `new
		// LocalShareLinkStore(...)`: `listByOrg` walks link → definition → project,
		// and those hops are wired by setters in `fromEnv`. Constructing the store
		// alone would leave the roster reading empty and the conformance cases
		// passing against nothing.
		createStore: () =>
			LocalDataProvider.fromEnv({ DATA_PATH: tempDir, SELVA_AT_REST_KEY: AT_REST_KEY }).shareLinks,
		createScope: async () => {
			const provider = LocalDataProvider.fromEnv({
				DATA_PATH: tempDir,
				SELVA_AT_REST_KEY: AT_REST_KEY
			});
			const ownerId = 'user-1';
			const orgId = 'org-1';
			const otherOrgId = 'org-2';
			const projectId = 'proj-1';
			const definitionId = 'def-1';
			const otherDefinitionId = 'def-2';
			const now = new Date().toISOString();

			for (const [id, slug, name] of [
				[orgId, 'roster-org', 'Roster Org'],
				[otherOrgId, 'other-org', 'Other Org']
			]) {
				await provider.orgs.createOrg(SYSTEM_CONTEXT, {
					id,
					name,
					slug,
					ownerId,
					createdBy: ownerId,
					updatedBy: ownerId,
					createdAt: now,
					updatedAt: now
				});
			}

			await provider.projects.createProject(SYSTEM_CONTEXT, {
				id: projectId,
				orgId,
				name: 'Roster Project',
				slug: 'roster-project',
				visibility: 'public',
				ownerId,
				createdBy: ownerId,
				updatedBy: ownerId,
				autoJoinOnUpload: false,
				createdAt: now,
				updatedAt: now
			});

			for (const [guid, displayName] of [
				[definitionId, 'Def A'],
				[otherDefinitionId, 'Def B']
			]) {
				await provider.definitions.create(SYSTEM_CONTEXT, {
					guid,
					projectId,
					ownerId,
					createdBy: ownerId,
					updatedBy: ownerId,
					displayName,
					status: 'published',
					solveCount: 0,
					nextVersionNumber: 2,
					liveVersionId: null,
					draftVersionId: null,
					createdAt: now,
					updatedAt: now
				});
			}

			return { ownerId, definitionId, otherDefinitionId, orgId, otherOrgId };
		}
	});
});
