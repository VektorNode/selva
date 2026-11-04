import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeSecretKey } from '../secrets.js';

const KEY = randomBytes(32);

describe('decodeSecretKey', () => {
	it('reads hex and base64, padded or not', () => {
		expect(decodeSecretKey(KEY.toString('hex'))).toEqual(KEY);
		expect(decodeSecretKey(KEY.toString('base64'))).toEqual(KEY);
		expect(decodeSecretKey(KEY.toString('base64').replace(/=+$/, ''))).toEqual(KEY);
	});

	it('tolerates the trailing newline a secrets file leaves', () => {
		expect(decodeSecretKey(`${KEY.toString('hex')}\n`)).toEqual(KEY);
		expect(decodeSecretKey(`  ${KEY.toString('base64')}\n`)).toEqual(KEY);
	});

	it('refuses junk around a valid key', () => {
		expect(() => decodeSecretKey(`${KEY.toString('base64')}!!!`)).toThrow(/32 bytes/);
		expect(() => decodeSecretKey(`!${KEY.toString('base64')}`)).toThrow(/32 bytes/);
	});

	it('refuses a passphrase that merely has the right length', () => {
		expect(() => decodeSecretKey('this is a forty three character passphrase!')).toThrow(
			/32 bytes/
		);
		// Base64 alphabet, 43 chars, but the last character carries stray bits.
		expect(() => decodeSecretKey(`${'a'.repeat(42)}b`)).toThrow(/32 bytes/);
	});
});
