import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runPlatformPermissionStoreConformance } from '@selvajs/platform/testing';
import { LocalPlatformPermissionStore } from '../LocalPlatformPermissionStore.js';
import { LocalAuthProvider } from '../../auth/LocalAuthProvider.js';

describe('LocalPlatformPermissionStore', () => {
	let tempDir: string;
	let counter = 0;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-perm-test-'));
		counter = 0;
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runPlatformPermissionStoreConformance({
		name: 'LocalPlatformPermissionStore',
		createStore: async () => {
			const usersFilePath = path.join(tempDir, 'users.json');
			const auth = new LocalAuthProvider({
				hmacSecret: 'test-secret',
				usersFilePath
			});
			const store = new LocalPlatformPermissionStore(usersFilePath);
			return {
				store,
				seedUser: async () => {
					counter += 1;
					const user = await auth.passwordAuth.createUserWithPassword(
						`seed-${counter}@example.com`,
						'pw12345678'
					);
					return user.id;
				}
			};
		}
	});
});
