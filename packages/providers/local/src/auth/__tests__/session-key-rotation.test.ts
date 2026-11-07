import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalAuthProvider } from '../LocalAuthProvider.js';
import { signHmacToken } from '../hmac.js';

const CURRENT = 'current-session-key-at-least-32-chars-long';
const PREVIOUS = 'previous-session-key-at-least-32-chars-xx';
const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-06-01T00:00:00.000Z');

let dir: string;
let usersFilePath: string;
let userId: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-key-rotation-'));
	usersFilePath = path.join(dir, 'auth-users.json');
	const seeding = new LocalAuthProvider({ hmacSecret: CURRENT, usersFilePath });
	userId = (await seeding.passwordAuth.createUserWithPassword('rotate@x.io', 'a-password')).id;
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
});

afterEach(async () => {
	vi.useRealTimers();
	await fs.rm(dir, { recursive: true, force: true });
});

function provider(previous?: { secret: string; expiresAt?: number }): LocalAuthProvider {
	return new LocalAuthProvider({
		hmacSecret: CURRENT,
		previousHmacSecret: previous?.secret,
		previousHmacSecretExpiresAt: previous?.expiresAt,
		usersFilePath
	});
}

describe('LocalAuthProvider.verifyToken across a key rotation', () => {
	it('accepts a session signed with the previous key before its deadline', async () => {
		const auth = provider({ secret: PREVIOUS, expiresAt: START + 2 * HOUR });
		const token = signHmacToken(PREVIOUS, userId);
		vi.setSystemTime(START + HOUR);
		expect((await auth.verifyToken(token))?.id).toBe(userId);
	});

	it('refuses that session once the deadline passes, though the token itself has not expired', async () => {
		const auth = provider({ secret: PREVIOUS, expiresAt: START + HOUR });
		const token = signHmacToken(PREVIOUS, userId, 8 * HOUR);
		vi.setSystemTime(START + HOUR);
		expect(await auth.verifyToken(token)).toBeNull();
	});

	it('refuses it when no previous key is configured', async () => {
		const token = signHmacToken(PREVIOUS, userId);
		expect(await provider().verifyToken(token)).toBeNull();
	});

	it('keeps accepting sessions signed with the current key after the deadline', async () => {
		const auth = provider({ secret: PREVIOUS, expiresAt: START + HOUR });
		const token = signHmacToken(CURRENT, userId, 8 * HOUR);
		vi.setSystemTime(START + 2 * HOUR);
		expect((await auth.verifyToken(token))?.id).toBe(userId);
	});
});
