import { describe, it, expect } from 'vitest';
import { API_TOKEN_PREFIX, createApiTokenCodec } from '../api-token-codec.js';

const codec = createApiTokenCodec('x'.repeat(32));

describe('createApiTokenCodec', () => {
	it('mints 40-char selva_ keys that pass their own checksum', () => {
		for (let i = 0; i < 200; i++) {
			const raw = codec.mintRawToken();
			expect(raw).toMatch(/^selva_[0-9A-Za-z]{36}$/);
			expect(codec.hasValidChecksum(raw)).toBe(true);
		}
	});

	it('mints distinct keys', () => {
		const seen = new Set(Array.from({ length: 500 }, () => codec.mintRawToken()));
		expect(seen.size).toBe(500);
	});

	it('rejects a single changed character', () => {
		const raw = codec.mintRawToken();
		const i = API_TOKEN_PREFIX.length + 3;
		const swapped = raw[i] === 'a' ? 'b' : 'a';
		expect(codec.hasValidChecksum(raw.slice(0, i) + swapped + raw.slice(i + 1))).toBe(false);
	});

	it.each([
		['truncated', (r: string) => r.slice(0, -1)],
		['extended', (r: string) => r + 'a'],
		['wrong prefix', (r: string) => 'sk_' + r.slice(API_TOKEN_PREFIX.length)],
		['non-base62', (r: string) => r.slice(0, -1) + '-']
	])('rejects a %s key', (_label, mangle) => {
		expect(codec.hasValidChecksum(mangle(codec.mintRawToken()))).toBe(false);
	});

	it('hashes with the instance secret, so another secret gives another hash', () => {
		const raw = codec.mintRawToken();
		const other = createApiTokenCodec('y'.repeat(32));
		expect(codec.hashToken(raw)).not.toBe(other.hashToken(raw));
		expect(codec.hashToken(raw)).toBe(codec.hashToken(raw));
	});
});
