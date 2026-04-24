import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { runProjectStoreConformance } from '@selva/platform/testing';
import { ALL_PLATFORM_PERMISSIONS, ALL_ORG_PERMISSIONS } from '@selva/platform';
import {
	LocalOrgStoreLoader,
	LocalOrganizationProvider
} from '../../organizations/LocalOrganizationProvider.js';
import { LocalProjectProvider } from '../LocalProjectProvider.js';

describe('LocalProjectProvider', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runProjectStoreConformance({
		name: 'LocalProjectProvider',
		createStore: async () => {
			const loader = new LocalOrgStoreLoader(tempDir);
			const orgs = new LocalOrganizationProvider(loader);
			const store = new LocalProjectProvider(loader);
			// Explicitly create the host org for the project tests.
			const ownerId = randomUUID();
			const orgId = randomUUID();
			const now = new Date().toISOString();
			await orgs.createOrg(
				{
					userId: ownerId,
					platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
					orgPermissions: [...ALL_ORG_PERMISSIONS]
				},
				{
					id: orgId,
					name: 'Test Org',
					slug: 'test',
					ownerId,
					createdAt: now,
					updatedAt: now
				}
			);
			return { store, orgId, ownerId };
		}
	});
});
