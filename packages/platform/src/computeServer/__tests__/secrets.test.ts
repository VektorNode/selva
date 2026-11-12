import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	decryptSecret,
	decryptWithKeys,
	encryptSecret,
	isEncryptedSecret,
	isLegacyEnvelope,
	isUnknownEnvelope
} from '../secrets.js';

const KEY = randomBytes(32);

describe('secrets bound to a server id and URL', () => {
	const server = { id: 'server-a', url: 'https://compute.internal' };

	it('round-trips under the same binding', () => {
		const envelope = encryptSecret('rhino-key', KEY, server);
		expect(envelope.startsWith('enc:v3:')).toBe(true);
		expect(isLegacyEnvelope(envelope)).toBe(false);
		expect(decryptSecret(envelope, KEY, server)).toBe('rhino-key');
	});

	it('refuses once the server points at another URL', () => {
		const envelope = encryptSecret('rhino-key', KEY, server);
		expect(() =>
			decryptSecret(envelope, KEY, { ...server, url: 'https://attacker.example' })
		).toThrow();
	});

	it('refuses ciphertext copied onto another server with the same URL', () => {
		const envelope = encryptSecret('rhino-key', KEY, server);
		expect(() => decryptSecret(envelope, KEY, { ...server, id: 'server-b' })).toThrow();
	});

	it('refuses an id that only matches once the URL is folded into it', () => {
		const envelope = encryptSecret('rhino-key', KEY, { id: 'a:b', url: 'c' });
		expect(() => decryptSecret(envelope, KEY, { id: 'a', url: 'b:c' })).toThrow();
	});

	it('refuses a bound envelope read with the id alone', () => {
		const envelope = encryptSecret('rhino-key', KEY, server);
		expect(() => decryptSecret(envelope, KEY, server.id)).toThrow(/URL/);
	});

	it('opens a v2 envelope with the binding of the server it was sealed for', () => {
		const v2 = encryptSecret('rhino-key', KEY, server.id);
		expect(isLegacyEnvelope(v2)).toBe(true);
		expect(decryptSecret(v2, KEY, server)).toBe('rhino-key');
		expect(() => decryptSecret(v2, KEY, { ...server, id: 'server-b' })).toThrow();
	});

	it('opens a v1 envelope under any binding', () => {
		const v1 = encryptSecret('rhino-key', KEY);
		expect(isLegacyEnvelope(v1)).toBe(true);
		expect(decryptSecret(v1, KEY, server)).toBe('rhino-key');
	});
});

describe('truncated envelopes', () => {
	it('refuses an envelope cut short of a full GCM tag', () => {
		const full = Buffer.from(encryptSecret('', KEY, 'server-a').slice('enc:v2:'.length), 'base64');
		const fourByteTag = 'enc:v2:' + full.subarray(0, 16).toString('base64');
		expect(() => decryptSecret(fourByteTag, KEY, 'server-a')).toThrow(/IV and tag/);
	});
});

describe('an envelope from a newer format', () => {
	it('is told apart from plaintext and from envelopes this build opens', () => {
		expect(isUnknownEnvelope('enc:v4:AAAA')).toBe(true);
		expect(isUnknownEnvelope('enc:v12:AAAA')).toBe(true);
		expect(isUnknownEnvelope('plaintext-key')).toBe(false);
		expect(isUnknownEnvelope(encryptSecret('k', KEY))).toBe(false);
		expect(isUnknownEnvelope(encryptSecret('k', KEY, { id: 'a', url: 'http://h' }))).toBe(false);
	});
});

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
