// Every helper must behave the same with and without Node's `Buffer`: the tests delete it to
// exercise the browser path.
import { afterEach, describe, expect, it } from 'vitest';
import {
	encodeStringToBase64,
	decodeBase64ToBinary,
	base64ByteArray,
	utf8ByteLength,
	detectBase64Payload,
	BASE64_DETECT_MIN_LENGTH
} from '../encoding';
import { ComputeError, ErrorCodes } from '@/core/errors';

const originalBuffer = (globalThis as any).Buffer;

const decode = (b64: string): string => new TextDecoder('utf-8').decode(decodeBase64ToBinary(b64));

afterEach(() => {
	(globalThis as any).Buffer = originalBuffer;
});

describe('string base64 helpers', () => {
	it('round-trips with Buffer available (Node path)', () => {
		const encoded = encodeStringToBase64('hello wörld');
		expect(decode(encoded)).toBe('hello wörld');
	});

	it('round-trips without Buffer (browser fallback path)', () => {
		delete (globalThis as any).Buffer;

		const encoded = encodeStringToBase64('hello wörld');
		expect(decode(encoded)).toBe('hello wörld');
	});

	it('browser fallback produces the same base64 as the Buffer path', () => {
		const viaBuffer = encodeStringToBase64('multi-byte: ✓ 日本語');
		delete (globalThis as any).Buffer;
		const viaFallback = encodeStringToBase64('multi-byte: ✓ 日本語');
		expect(viaFallback).toBe(viaBuffer);
	});
});

describe('decodeBase64ToBinary error paths', () => {
	it('throws ENCODING_ERROR on characters outside the alphabet', () => {
		expect(() => decodeBase64ToBinary('not base64!!!')).toThrowError(ComputeError);
		try {
			decodeBase64ToBinary('####');
		} catch (error) {
			expect((error as ComputeError).code).toBe(ErrorCodes.ENCODING_ERROR);
		}
	});

	it('throws ENCODING_ERROR on an impossible length (len % 4 === 1 after normalization)', () => {
		expect(() => decodeBase64ToBinary('AAAAA')).toThrowError(ComputeError);
	});

	it('throws ENCODING_ERROR on misplaced padding', () => {
		expect(() => decodeBase64ToBinary('AB=AAAAA')).toThrowError(ComputeError);
	});

	it('throws the SAME error on the browser (atob) path as on the Node path', () => {
		delete (globalThis as any).Buffer;
		try {
			decodeBase64ToBinary('####');
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(ComputeError);
			expect((error as ComputeError).code).toBe(ErrorCodes.ENCODING_ERROR);
		}
	});

	it('accepts forgiving-base64: whitespace-wrapped and unpadded input', () => {
		const wrapped = 'aGVs\nbG8g\r\nd29y\nbGQ='; // "hello world" wrapped
		expect(new TextDecoder().decode(decodeBase64ToBinary(wrapped))).toBe('hello world');
		expect(new TextDecoder().decode(decodeBase64ToBinary('aGVsbG8'))).toBe('hello'); // unpadded
	});
});

describe('decodeBase64ToBinary pool aliasing', () => {
	it('returns bytes backed by an exactly-sized, non-shared ArrayBuffer', () => {
		const bytes = decodeBase64ToBinary('aGVsbG8='); // "hello", 5 bytes
		expect(bytes.byteOffset).toBe(0);
		// A view over Node's shared pool would report the whole 8 KiB slab here.
		expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
		expect(bytes.byteLength).toBe(5);
	});

	it('mutating the result does not corrupt a sibling decode (no shared slab)', () => {
		const a = decodeBase64ToBinary('AAAAAA=='); // 4 zero bytes
		const b = decodeBase64ToBinary('AAAAAA==');
		a.fill(0xff);
		expect(Array.from(b)).toEqual([0, 0, 0, 0]);
	});
});

describe('base64ByteArray chunk boundaries', () => {
	it('browser fallback matches the Buffer path across the >32768-byte chunk boundary', () => {
		// Deliberately NOT a multiple of the 32766-byte chunk: exercises several
		// full chunks plus a ragged final one, and both padded/unpadded tails.
		for (const size of [32765, 32766, 32767, 32768, 100_001]) {
			const bytes = new Uint8Array(size);
			for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;

			const viaBuffer = base64ByteArray(bytes);
			delete (globalThis as any).Buffer;
			const viaFallback = base64ByteArray(bytes);
			(globalThis as any).Buffer = originalBuffer;

			expect(viaFallback).toBe(viaBuffer);
		}
	});

	it('browser fallback round-trips through decode', () => {
		const bytes = new Uint8Array(70_000);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + 1) & 0xff;
		delete (globalThis as any).Buffer;
		const encoded = base64ByteArray(bytes);
		(globalThis as any).Buffer = originalBuffer;
		expect(decodeBase64ToBinary(encoded)).toEqual(bytes);
	});
});

describe('utf8ByteLength', () => {
	const cases = [
		'',
		'ascii only',
		'wörld', // 2-byte code points
		'日本語', // 3-byte code points
		'𐍈 emoji 🦄 pair', // surrogate pairs → 4-byte code points
		'\uD800', // lone high surrogate
		'tail\uDC00', // lone low surrogate
		'\uD800𐀀' // lone high followed by a valid pair
	];

	it.each(cases)('matches TextEncoder for %j', (str) => {
		expect(utf8ByteLength(str)).toBe(new TextEncoder().encode(str).length);
	});

	it('matches on the fallback (no Buffer) path too', () => {
		delete (globalThis as any).Buffer;
		for (const str of cases) {
			expect(utf8ByteLength(str)).toBe(new TextEncoder().encode(str).length);
		}
	});
});

describe('detectBase64Payload heuristic', () => {
	// 96 chars of canonical base64 (72 bytes), the realistic "definition" shape.
	const longB64 = originalBuffer
		.from(new Uint8Array(72).map((_, i) => i * 3 + 1))
		.toString('base64') as string;

	it('rejects short base64-shaped human strings ("test", "Data2024")', () => {
		expect(detectBase64Payload('test')).toBeNull();
		expect(detectBase64Payload('Data2024')).toBeNull();
		expect(detectBase64Payload('dGVzdA==')).toBeNull(); // valid but tiny
	});

	it('rejects anything shorter than the minimum length floor', () => {
		const under = 'A'.repeat(BASE64_DETECT_MIN_LENGTH - 4);
		expect(detectBase64Payload(under)).toBeNull();
	});

	it('accepts long canonical base64 verbatim', () => {
		expect(longB64.length).toBeGreaterThanOrEqual(BASE64_DETECT_MIN_LENGTH);
		expect(detectBase64Payload(longB64)).toBe(longB64);
	});

	it('accepts newline-wrapped base64, returning the canonical form (no double-encode)', () => {
		const wrapped = longB64.replace(/(.{20})/g, '$1\r\n');
		expect(detectBase64Payload(wrapped)).toBe(longB64);
	});

	it('accepts unpadded base64, restoring the padding', () => {
		const padded = originalBuffer
			.from(new Uint8Array(70).map((_, i) => i + 1))
			.toString('base64') as string;
		expect(padded.endsWith('==')).toBe(true);
		expect(detectBase64Payload(padded.replace(/=+$/, ''))).toBe(padded);
	});

	it('rejects non-canonical base64 (nonzero trailing bits — not produced by an encoder)', () => {
		// 66 data chars (% 4 === 2): the final char's low 4 bits must be zero.
		// 'B' (value 1) fails; 'Q' (value 16) passes.
		const body = 'A'.repeat(65);
		expect(detectBase64Payload(`${body}B`)).toBeNull();
		expect(detectBase64Payload(`${body}Q`)).toBe(`${body}Q==`);
	});

	it('rejects impossible lengths and out-of-alphabet characters', () => {
		expect(detectBase64Payload('A'.repeat(65))).toBeNull(); // % 4 === 1
		expect(detectBase64Payload(`${'A'.repeat(60)} not base64!`)).toBeNull();
		expect(detectBase64Payload('')).toBeNull();
	});

	it('documents the residual ambiguity: a long alphabet-only plain string IS detected', () => {
		// 64 'A's decode to 48 zero bytes — indistinguishable from real base64.
		// Callers that must be exact pass Uint8Array; pinned so a change is loud.
		expect(detectBase64Payload('A'.repeat(64))).toBe('A'.repeat(64));
	});
});

describe('decodeBase64ToBinary — strictness on both paths', () => {
	/** The WHATWG forgiving-base64 rules, spelled out: what both decoders must accept. */
	function reference(input: string): number[] | null {
		let data = input.replace(/[\t\n\f\r ]/g, '');
		if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
		if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) return null;
		return [...originalBuffer.from(data, 'base64')];
	}
	const attempt = (input: string): number[] | null => {
		try {
			return [...decodeBase64ToBinary(input)];
		} catch {
			return null;
		}
	};

	// Valid encodings, then near misses: each mutation splices in a character Buffer decodes
	// leniently (base64url, the low byte of non-ASCII), stops on, or skips.
	const tricky = ['A', '+', '/', '=', '-', '_', ' ', '\n', '.', 'é', 'Ł', '\ud800'];
	let seed = 7;
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

	it('accepts and rejects exactly what the forgiving-base64 rules do, with Buffer', () => {
		for (const s of samples) expect(attempt(s), JSON.stringify(s)).toEqual(reference(s));
	});

	it('accepts and rejects exactly what the forgiving-base64 rules do, with atob', () => {
		delete (globalThis as any).Buffer;
		for (const s of samples) expect(attempt(s), JSON.stringify(s)).toEqual(reference(s));
	});

	it('returns a large result that owns its whole ArrayBuffer', () => {
		const bytes = decodeBase64ToBinary(originalBuffer.alloc(1 << 20, 9).toString('base64'));
		expect(bytes.length).toBe(1 << 20);
		expect(bytes.buffer.byteLength).toBe(1 << 20);
		expect(bytes[12345]).toBe(9);
	});

	it('copies a small result out of the shared pool', () => {
		const bytes = decodeBase64ToBinary('AQID');
		expect([...bytes]).toEqual([1, 2, 3]);
		expect(bytes.buffer.byteLength).toBe(3);
	});
});
