/**
 * `verifyToken` runs on every authenticated request, so it must stay
 * READ-ONLY — never rewrite `auth-users.json`. `lastLoginAt` is a login-time
 * concern stamped by `verifyLogin`; its only consumers treat it as a
 * has-ever-signed-in flag (admin/team "invited" vs "active" labels).
 *
 * Regression guard against a per-request write creeping back into `verifyToken`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { LocalAuthProvider } from '../LocalAuthProvider.js';

const SECRET = 'test-hmac-secret-for-last-login';
const EMAIL = 'user@example.com';
const PASSWORD = 'a-test-password';

let tempDir: string;
let usersFilePath: string;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-last-login-'));
	usersFilePath = path.join(tempDir, 'auth-users.json');
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

function makeProvider(): LocalAuthProvider {
	return new LocalAuthProvider({ hmacSecret: SECRET, usersFilePath });
}

describe('LocalAuthProvider — lastLoginAt / verifyToken read-only', () => {
	it('verifyLogin stamps lastLoginAt', async () => {
		const provider = makeProvider();
		await provider.passwordAuth.createUserWithPassword(EMAIL, PASSWORD);

		const before = await provider.passwordAuth.verifyLogin(EMAIL, PASSWORD);
		expect(before.kind).toBe('success');

		const user = await provider.getUser(before.kind === 'success' ? before.user.id : '');
		expect(user?.lastLoginAt).toBeTruthy();
	});

	it('verifyToken does not write to auth-users.json', async () => {
		const provider = makeProvider();
		await provider.passwordAuth.createUserWithPassword(EMAIL, PASSWORD);
		const login = await provider.passwordAuth.verifyLogin(EMAIL, PASSWORD);
		if (login.kind !== 'success') throw new Error('login failed');

		// Snapshot the file, then verify the token many times.
		const snapshot = await fs.readFile(usersFilePath, 'utf8');
		const mtimeBefore = (await fs.stat(usersFilePath)).mtimeMs;

		for (let i = 0; i < 5; i++) {
			const u = await provider.verifyToken(login.sessionToken);
			expect(u?.id).toBe(login.user.id);
		}

		const after = await fs.readFile(usersFilePath, 'utf8');
		const mtimeAfter = (await fs.stat(usersFilePath)).mtimeMs;
		expect(after).toBe(snapshot);
		expect(mtimeAfter).toBe(mtimeBefore);
	});

	it('verifyToken still returns the live user (incl. disabled → null)', async () => {
		const provider = makeProvider();
		const created = await provider.passwordAuth.createUserWithPassword(EMAIL, PASSWORD);
		const login = await provider.passwordAuth.verifyLogin(EMAIL, PASSWORD);
		if (login.kind !== 'success') throw new Error('login failed');

		expect((await provider.verifyToken(login.sessionToken))?.id).toBe(created.id);

		await provider.disableUser(created.id);
		expect(await provider.verifyToken(login.sessionToken)).toBeNull();
	});
});
