import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runUserProfileStoreConformance } from '@selvajs/platform/testing';
import { LocalAuthProvider } from '../../auth/LocalAuthProvider.js';
import { LocalUserProfileProvider } from '../LocalUserProfileProvider.js';

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
			const usersFilePath = path.join(tempDir, 'users.json');
			const auth = new LocalAuthProvider({
				hmacSecret: 'test-secret',
				usersFilePath
			});
			const store = new LocalUserProfileProvider(usersFilePath);
			return {
				store,
				seedUser: async (email: string) => {
					const user = await auth.passwordAuth.createUserWithPassword(email, 'pw');
					return user;
				}
			};
		}
	});
});
