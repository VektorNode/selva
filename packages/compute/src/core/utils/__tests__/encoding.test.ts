/**
 * Regression tests for the env-portable base64 helpers.
 *
 * - encodeStringToBase64 must work without Node's `Buffer` (browsers/workers),
 *   falling back to TextEncoder + btoa. It used bare `Buffer` and threw a
 *   ReferenceError in browsers — reachable from prepareGrasshopperArgs'
 *   plain-string path.
 * - decodeBase64ToBinary error paths, pool-copy behavior (issue 107), and the
 *   >32768-byte chunk boundary of the browser encode fallback (issue 108).
 * - utf8ByteLength surrogate handling.
 * - detectBase64Payload heuristic pins (issues 69/92).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
	encodeStringToBase64,
	decodeBase64ToBinary,
	base64ByteArray,
	utf8ByteLength,
	isBase64,
	detectBase64Payload,
	BASE64_DETECT_MIN_LENGTH
} from '../encoding';
import { RhinoComputeError, ErrorCodes } from '@/core/errors';

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
		expect(() => decodeBase64ToBinary('not base64!!!')).toThrowError(RhinoComputeError);
		try {
			decodeBase64ToBinary('####');
		} catch (error) {
			expect((error as RhinoComputeError).code).toBe(ErrorCodes.ENCODING_ERROR);
		}
	});

	it('throws ENCODING_ERROR on an impossible length (len % 4 === 1 after normalization)', () => {
		expect(() => decodeBase64ToBinary('AAAAA')).toThrowError(RhinoComputeError);
	});

	it('throws ENCODING_ERROR on misplaced padding', () => {
		expect(() => decodeBase64ToBinary('AB=AAAAA')).toThrowError(RhinoComputeError);
	});

	it('throws the SAME error on the browser (atob) path as on the Node path', () => {
		delete (globalThis as any).Buffer;
		try {
			decodeBase64ToBinary('####');
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(RhinoComputeError);
			expect((error as RhinoComputeError).code).toBe(ErrorCodes.ENCODING_ERROR);
		}
	});

	it('accepts forgiving-base64: whitespace-wrapped and unpadded input', () => {
		const wrapped = 'aGVs\nbG8g\r\nd29y\nbGQ='; // "hello world" wrapped
		expect(new TextDecoder().decode(decodeBase64ToBinary(wrapped))).toBe('hello world');
		expect(new TextDecoder().decode(decodeBase64ToBinary('aGVsbG8'))).toBe('hello'); // unpadded
	});
});

describe('decodeBase64ToBinary pool aliasing (issue 107)', () => {
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

describe('base64ByteArray chunk boundaries (issue 108)', () => {
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

describe('detectBase64Payload heuristic (issues 69/92)', () => {
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

describe('isBase64 (syntactic check, unchanged semantics)', () => {
	it('remains a pure syntax check — short strings like "test" still pass', () => {
		expect(isBase64('test')).toBe(true);
		expect(isBase64('SGVsbG8=')).toBe(true);
		expect(isBase64('not base64!!!')).toBe(false);
		expect(isBase64('AAA')).toBe(false); // length % 4 !== 0
	});
});
