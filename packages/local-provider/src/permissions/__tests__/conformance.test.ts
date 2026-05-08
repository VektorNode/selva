import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runPlatformPermissionStoreConformance } from '@selvajs/platform/testing';
import { LocalPlatformPermissionStore } from '../LocalPlatformPermissionStore.js';
import { createLocalUserDataStore } from '../../data/userData.js';
import { randomUUID } from 'node:crypto';

describe('LocalPlatformPermissionStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-perm-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runPlatformPermissionStoreConformance({
		name: 'LocalPlatformPermissionStore',
		createStore: async () => {
			const userDataPath = path.join(tempDir, 'user-data.json');
			const userData = createLocalUserDataStore(userDataPath);
			const store = new LocalPlatformPermissionStore(userDataPath);
			return {
				store,
				seedUser: async () => {
					// Mirrors `IDataProvider.ensureUser` — produces a user the data
					// layer knows about, regardless of which auth provider would
					// hand out the ID in production.
					const id = randomUUID();
					await userData.ensure(id);
					return id;
				}
			};
		}
	});
});
