import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runAuthProviderConformance } from '@selva/platform/testing';
import { LocalAuthProvider } from '../LocalAuthProvider.js';

const TEST_SECRET = 'test-hmac-secret-for-conformance';
const TEST_PASSWORD = 'test-admin-password';

describe('LocalAuthProvider — fallback mode (no users.json)', () => {
	runAuthProviderConformance({
		name: 'LocalAuthProvider/fallback',
		createProvider: () => ({
			provider: new LocalAuthProvider({
				hmacSecret: TEST_SECRET,
				fallbackAdminPassword: TEST_PASSWORD
			}),
			adminPassword: TEST_PASSWORD
		}),
		userManagement: false
	});
});

describe('LocalAuthProvider — users.json mode', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-auth-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	runAuthProviderConformance({
		name: 'LocalAuthProvider/users-json',
		createProvider: () => ({
			provider: new LocalAuthProvider({
				hmacSecret: TEST_SECRET,
				usersFilePath: path.join(tempDir, 'users.json'),
				fallbackAdminPassword: TEST_PASSWORD
			}),
			adminPassword: TEST_PASSWORD
		}),
		userManagement: true
	});
});
