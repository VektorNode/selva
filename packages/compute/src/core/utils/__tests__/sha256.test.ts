import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { sha256Hex, sha256HexPortable } from '../sha256';

const ascii = (s: string) => new TextEncoder().encode(s);
const nodeHex = (input: string | Uint8Array) =>
	typeof input === 'string'
		? createHash('sha256').update(input, 'utf16le').digest('hex')
		: createHash('sha256').update(input).digest('hex');

describe('sha256HexPortable', () => {
	it('matches the FIPS 180-4 test vectors', () => {
		expect(sha256HexPortable(new Uint8Array())).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
		);
		expect(sha256HexPortable(ascii('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
		expect(
			sha256HexPortable(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
		).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
		expect(sha256HexPortable(new Uint8Array(1_000_000).fill(0x61))).toBe(
			'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
		);
	});

	it('agrees with node:crypto across block boundaries', () => {
		for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 70_000]) {
			const bytes = randomBytes(length);
			expect(sha256HexPortable(bytes)).toBe(nodeHex(bytes));
		}
	});

	it('hashes strings as UTF-16LE, past the internal chunk size', () => {
		const samples = ['', 'a', 'ü€😀', '\ud800', '\udc00x', 'x'.repeat(40_000) + '日本'];
		for (const s of samples) expect(sha256HexPortable(s)).toBe(nodeHex(s));
	});
});

describe('sha256Hex', () => {
	it('gives the portable result on Node', () => {
		for (const input of ['hello', '\ud800', ascii('hello')]) {
			expect(sha256Hex(input)).toBe(sha256HexPortable(input));
		}
	});

	it('keeps lone surrogates distinct', () => {
		expect(sha256Hex('\ud800')).not.toBe(sha256Hex('\ud801'));
	});
});
