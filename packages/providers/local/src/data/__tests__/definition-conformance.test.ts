import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runDefinitionStoreConformance } from '@selvajs/platform/testing';
import { SYSTEM_CONTEXT, type Project } from '@selvajs/platform';
import { LocalDataProvider } from '../LocalDataProvider.js';

describe('LocalDefinitionStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	// One provider per test, shared by both factories: its stores cache the files they
	// read, so projects seeded through a second instance would never show up.
	let provider: LocalDataProvider;

	runDefinitionStoreConformance({
		name: 'LocalDefinitionStore',
		createStore: () => {
			provider = LocalDataProvider.fromEnv({
				DATA_PATH: tempDir,
				SELVA_AT_REST_KEY: '0'.repeat(64)
			});
			return provider.definitions;
		},
		// `listPublic` reads each record's project, so the scope's projects are real.
		createScope: async () => {
			const ownerId = 'user-1';
			const orgId = 'org-1';
			const now = new Date().toISOString();
			await provider.orgs.createOrg(SYSTEM_CONTEXT, {
				id: orgId,
				name: 'Definition Org',
				slug: 'definition-org',
				ownerId,
				createdBy: ownerId,
				updatedBy: ownerId,
				createdAt: now,
				updatedAt: now
			});
			const projects: Array<[string, Project['visibility']]> = [
				['project-1', 'public'],
				['project-2', 'public'],
				['project-3', 'private']
			];
			for (const [id, visibility] of projects) {
				await provider.projects.createProject(SYSTEM_CONTEXT, {
					id,
					orgId,
					name: id,
					slug: id,
					visibility,
					ownerId,
					createdBy: ownerId,
					updatedBy: ownerId,
					autoJoinOnUpload: false,
					createdAt: now,
					updatedAt: now
				});
			}
			return {
				ownerId,
				projectId: 'project-1',
				secondaryProjectId: 'project-2',
				privateProjectId: 'project-3',
				secondaryUserId: 'user-b'
			};
		},
		strictDenials: true,
		nonAdminCtx: true,
		auditStamps: true,
		publicListing: true
	});
});
