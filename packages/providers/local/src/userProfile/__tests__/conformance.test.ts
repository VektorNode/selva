import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runUserProfileStoreConformance } from '@selvajs/platform/testing';
import { LocalAuthProvider } from '../../auth/LocalAuthProvider.js';
import { LocalUserProfileProvider } from '../LocalUserProfileProvider.js';
import { createLocalUserDataStore } from '../../data/userData.js';

describe('LocalUserProfileProvider', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-userprofile-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runUserProfileStoreConformance({
		name: 'LocalUserProfileProvider',
		createStore: async () => {
			const auth = new LocalAuthProvider({
				hmacSecret: 'test-secret',
				usersFilePath: path.join(tempDir, 'auth-users.json')
			});
			const userDataPath = path.join(tempDir, 'user-data.json');
			const userData = createLocalUserDataStore(userDataPath);
			const store = new LocalUserProfileProvider(userDataPath);
			return {
				store,
				seedUser: async (email: string) => {
					// Creates both the auth-users row and the user-data row, mirroring
					// hooks.server.ts's ensureUser flow in production.
					const user = await auth.passwordAuth.createUserWithPassword(email, 'pw');
					await userData.ensure(user.id);
					return user;
				}
			};
		}
	});
});
