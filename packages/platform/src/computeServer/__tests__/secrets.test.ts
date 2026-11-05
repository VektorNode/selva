import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../secrets.js';
import { decryptWithKeys } from '../secrets.js';

const KEY = randomBytes(32);

describe('secrets bound to a server id', () => {
	it('round-trips under the same id', () => {
		const envelope = encryptSecret('rhino-key', KEY, 'server-a');
		expect(isEncryptedSecret(envelope)).toBe(true);
		expect(decryptSecret(envelope, KEY, 'server-a')).toBe('rhino-key');
	});

	it('refuses ciphertext replayed onto another server', () => {
		const envelope = encryptSecret('rhino-key', KEY, 'server-a');
		expect(() => decryptSecret(envelope, KEY, 'server-b')).toThrow();
	});

	it('refuses a bound envelope read without the id', () => {
		const envelope = encryptSecret('rhino-key', KEY, 'server-a');
		expect(() => decryptSecret(envelope, KEY)).toThrow();
	});

	it('still reads an envelope written before binding', () => {
		const legacy = encryptSecret('rhino-key', KEY);
		expect(legacy.startsWith('enc:v1:')).toBe(true);
		expect(decryptSecret(legacy, KEY, 'server-a')).toBe('rhino-key');
	});

	it('refuses to encrypt a value that is already an envelope', () => {
		const envelope = encryptSecret('rhino-key', KEY, 'server-a');
		expect(() => encryptSecret(envelope, KEY, 'server-b')).toThrow(/already encrypted/);
	});
});

describe('decryptWithKeys', () => {
	const current = Buffer.alloc(32, 1);
	const previous = Buffer.alloc(32, 2);

	it('opens a secret sealed under the previous key and says so', () => {
		const sealed = encryptSecret('api-key', previous, 'server-1');
		expect(decryptWithKeys(sealed, [current, previous], 'server-1')).toEqual({
			plaintext: 'api-key',
			keyIndex: 1
		});
	});

	it('prefers the current key', () => {
		const sealed = encryptSecret('api-key', current, 'server-1');
		expect(decryptWithKeys(sealed, [current, previous], 'server-1').keyIndex).toBe(0);
	});

	it('throws when no key opens it, as a single-key decrypt would', () => {
		const sealed = encryptSecret('api-key', Buffer.alloc(32, 3), 'server-1');
		expect(() => decryptWithKeys(sealed, [current, previous], 'server-1')).toThrow();
	});
});
