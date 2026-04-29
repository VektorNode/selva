import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { runProjectStoreConformance } from '@selvajs/platform/testing';
import { ALL_PLATFORM_PERMISSIONS, ALL_ORG_PERMISSIONS } from '@selvajs/platform';
import { LocalOrgStoreLoader, LocalOrgStore } from '../LocalOrgStore.js';
import { LocalProjectStore } from '../LocalProjectStore.js';
import { LocalInviteStore } from '../LocalInviteStore.js';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';
import { LocalPlatformProjectGrantStore } from '../LocalPlatformProjectGrantStore.js';

describe('LocalProjectStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runProjectStoreConformance({
		name: 'LocalProjectStore',
		createStore: async () => {
			const loader = new LocalOrgStoreLoader(tempDir);
			const invites = new LocalInviteStore(tempDir);
			const computeServer = new LocalComputeServerStore(path.join(tempDir, 'compute.config.json'));
			const grants = new LocalPlatformProjectGrantStore(
				path.join(tempDir, 'platform-project-grants.json')
			);
			const orgs = new LocalOrgStore({ loader, invites, computeServer, grants });
			const store = new LocalProjectStore({ loader, grants });
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
					createdBy: ownerId,
					updatedBy: ownerId,
					createdAt: now,
					updatedAt: now,
					deletedAt: null
				}
			);
			return { store, orgId, ownerId };
		}
	});
});
