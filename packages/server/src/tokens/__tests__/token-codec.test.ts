import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createTokenCodec, MIN_TOKEN_SECRET_LENGTH } from '../token-codec.js';

const SECRET = 'unit-test-secret-that-is-long-enough-to-pass';

describe('createTokenCodec', () => {
	it('rejects a secret shorter than the minimum', () => {
		expect(() => createTokenCodec({ prefix: 'share_', secret: 'short' })).toThrow(
			/at least 32 characters/
		);
		expect(() =>
			createTokenCodec({ prefix: 'share_', secret: 'x'.repeat(MIN_TOKEN_SECRET_LENGTH - 1) })
		).toThrow(/got 31/);
	});

	it('accepts a secret at exactly the minimum length', () => {
		expect(() =>
			createTokenCodec({ prefix: 'share_', secret: 'x'.repeat(MIN_TOKEN_SECRET_LENGTH) })
		).not.toThrow();
	});

	it('mints prefixed, unique, URL-safe tokens', () => {
		const codec = createTokenCodec({ prefix: 'share_', secret: SECRET });
		const a = codec.mintRawToken();
		const b = codec.mintRawToken();
		expect(a).toMatch(/^share_[A-Za-z0-9_-]{43}$/); // 32 bytes → 43 base64url chars
		expect(a).not.toBe(b);
	});

	it('hashes deterministically, never echoing the raw token', () => {
		const codec = createTokenCodec({ prefix: 'share_', secret: SECRET });
		const raw = codec.mintRawToken();
		const hash = codec.hashToken(raw);
		expect(codec.hashToken(raw)).toBe(hash);
		expect(hash).not.toContain(raw);
		expect(hash).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/);
	});

	it('new hashes do not depend on the secret, so rotating it keeps tokens working', () => {
		const a = createTokenCodec({ prefix: 'share_', secret: SECRET });
		const b = createTokenCodec({ prefix: 'share_', secret: SECRET + '-rotated' });
		const raw = a.mintRawToken();
		expect(a.hashToken(raw)).toBe(b.hashToken(raw));
	});

	it('looks up the current form first, then hashes stored by the HMAC scheme under each key', () => {
		const previous = 'the-previous-secret-also-long-enough-to-pass';
		const codec = createTokenCodec({ prefix: 'share_', secret: SECRET, previousSecret: previous });
		const raw = codec.mintRawToken();
		const legacy = (key: string) => createHmac('sha256', key).update(raw).digest('base64url');
		expect(codec.lookupHashes(raw)).toEqual([
			codec.hashToken(raw),
			legacy(SECRET),
			legacy(previous)
		]);
		expect(createTokenCodec({ prefix: 'share_', secret: SECRET }).lookupHashes(raw)).toEqual([
			codec.hashToken(raw),
			legacy(SECRET)
		]);
	});

	it('hashesEqual: equal, unequal, and length-mismatch inputs', () => {
		const codec = createTokenCodec({ prefix: 'invite_', secret: SECRET });
		const hash = codec.hashToken(codec.mintRawToken());
		const other = codec.hashToken(codec.mintRawToken());
		expect(codec.hashesEqual(hash, hash)).toBe(true);
		expect(codec.hashesEqual(hash, other)).toBe(false);
		expect(codec.hashesEqual(hash, hash.slice(0, -1))).toBe(false);
	});

	it('looksLikeToken recognizes only its own prefix', () => {
		const share = createTokenCodec({ prefix: 'share_', secret: SECRET });
		const invite = createTokenCodec({ prefix: 'invite_', secret: SECRET });
		const raw = share.mintRawToken();
		expect(share.looksLikeToken(raw)).toBe(true);
		expect(invite.looksLikeToken(raw)).toBe(false);
		expect(share.looksLikeToken('random-string')).toBe(false);
	});
});
