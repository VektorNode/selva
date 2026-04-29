import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runOrgStoreConformance } from '@selvajs/platform/testing';
import { LocalOrgStore, LocalOrgStoreLoader } from '../LocalOrgStore.js';
import { LocalInviteStore } from '../LocalInviteStore.js';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';
import { LocalPlatformProjectGrantStore } from '../LocalPlatformProjectGrantStore.js';

describe('LocalOrgStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	const makeInvites = () => new LocalInviteStore(tempDir);
	const makeCompute = () => new LocalComputeServerStore(path.join(tempDir, 'compute.config.json'));
	const makeGrants = () =>
		new LocalPlatformProjectGrantStore(path.join(tempDir, 'platform-project-grants.json'));

	runOrgStoreConformance({
		name: 'LocalOrgStore',
		createStore: () =>
			new LocalOrgStore({
				loader: new LocalOrgStoreLoader(tempDir),
				invites: makeInvites(),
				computeServer: makeCompute(),
				grants: makeGrants()
			}),
		createCompanionStores: () => ({
			invites: makeInvites(),
			computeServer: makeCompute()
		})
	});
});
