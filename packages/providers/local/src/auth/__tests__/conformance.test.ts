import { describe, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runAuthProviderConformance } from '@selvajs/platform/testing';
import { LocalAuthProvider } from '../LocalAuthProvider.js';

const TEST_SECRET = 'test-hmac-secret-for-conformance';
const ADMIN_EMAIL = 'conformance-admin@example.com';
const ADMIN_PASSWORD = 'test-admin-password';

describe('LocalAuthProvider — auth-users.json mode', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-auth-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runAuthProviderConformance({
		name: 'LocalAuthProvider/auth-users-json',
		createProvider: async () => {
			const provider = new LocalAuthProvider({
				hmacSecret: TEST_SECRET,
				usersFilePath: path.join(tempDir, 'auth-users.json')
			});
			// Skip re-creating the admin if a prior call in this test already did —
			// createProvider can run more than once per test.
			const existing = await provider.passwordAuth.verifyLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
			if (existing.kind !== 'success') {
				await provider.passwordAuth.createUserWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
			}
			return { provider, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD };
		},
		userManagement: true
	});
});
