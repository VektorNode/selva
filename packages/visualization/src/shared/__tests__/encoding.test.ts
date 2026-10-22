// Mirrors the strictness tests on `@selvajs/compute`'s decodeBase64ToBinary, which this copies.
import { afterEach, describe, expect, it } from 'vitest';

import { decodeBase64ToBinary } from '../encoding.js';

const globals = globalThis as { Buffer?: typeof Buffer };
const originalBuffer = Buffer;

afterEach(() => {
	globals.Buffer = originalBuffer;
});

/** The WHATWG forgiving-base64 rules, spelled out: what both decoders must accept. */
function reference(input: string): number[] | null {
	let data = input.replace(/[\t\n\f\r ]/g, '');
	if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
	if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) return null;
	return [...originalBuffer.from(data, 'base64')];
}

function attempt(input: string): number[] | null {
	try {
		return [...decodeBase64ToBinary(input)];
	} catch {
		return null;
	}
}

// Valid encodings, then near misses: each mutation splices in a character Buffer decodes
// leniently (base64url, the low byte of non-ASCII), stops on, or skips.
const tricky = ['A', '+', '/', '=', '-', '_', ' ', '\n', '.', 'é', 'Ł', '\ud800'];
let seed = 11;
const random = (n: number) => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed % n;
};
const samples = Array.from({ length: 4000 }, () => {
	const bytes = Uint8Array.from({ length: random(40) }, () => random(256));
	let s = originalBuffer.from(bytes).toString('base64');
	for (let m = random(3); m > 0; m--) {
		const at = random(s.length + 1);
		s = s.slice(0, at) + tricky[random(tricky.length)] + s.slice(at + random(2));
	}
	return s;
});

describe('decodeBase64ToBinary', () => {
	it('accepts and rejects exactly what the forgiving-base64 rules do, with Buffer', () => {
		for (const s of samples) expect(attempt(s), JSON.stringify(s)).toEqual(reference(s));
	});

	it('accepts and rejects exactly what the forgiving-base64 rules do, with atob', () => {
		delete globals.Buffer;
		for (const s of samples) expect(attempt(s), JSON.stringify(s)).toEqual(reference(s));
	});
});
