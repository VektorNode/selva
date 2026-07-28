import { describe, it, expect } from 'vitest';
import { applyOptionalComputeSettings, prepareGrasshopperArgs } from '../solve';
import type { GrasshopperRequestSchema } from '../types';
import { isBase64 } from '@/core/utils/encoding';

describe('solve', () => {
	describe('prepareGrasshopperArgs', () => {
		it('should handle URL definition as pointer', () => {
			const definition = 'https://example.com/definition.gh';
			const dataTree: any[] = [];

			const result = prepareGrasshopperArgs(definition, dataTree);

			expect(result.pointer).toBe(definition);
			expect(result.algo).toBeNull();
			expect(result.values).toEqual(dataTree);
		});

		it('should encode plain string definition to base64', () => {
			const definition = 'plain text definition';
			const dataTree: any[] = [];

			const result = prepareGrasshopperArgs(definition, dataTree);

			expect(result.algo).toBeTruthy();
			expect(result.pointer).toBeNull();
			// Verify it's valid base64
			expect(isBase64(result.algo!)).toBe(true);
		});

		it('should pass through existing base64 string (realistic definition-sized input)', () => {
			// Real definitions are KB–MB; the detection floor is 64 base64 chars.
			const base64Definition = Buffer.from(
				new Uint8Array(256).map((_, i) => (i * 7 + 3) & 0xff)
			).toString('base64');
			const dataTree: any[] = [];

			const result = prepareGrasshopperArgs(base64Definition, dataTree);

			expect(result.algo).toBe(base64Definition);
			expect(result.pointer).toBeNull();
		});

		// Issues 69/92: short base64-shaped strings ("test", "dGVzdA==") used to
		// be sent raw, so the documented "plain string (will be base64-encoded)"
		// contract silently failed and the server decoded garbage. Detection now
		// requires ≥64 canonical base64 chars — anything shorter is treated as a
		// plain string and encoded.
		it('encodes short base64-shaped strings as plain text', () => {
			for (const definition of ['test', 'Data2024', Buffer.from('test').toString('base64')]) {
				const result = prepareGrasshopperArgs(definition, []);
				expect(result.algo).toBe(Buffer.from(definition, 'utf-8').toString('base64'));
				expect(result.pointer).toBeNull();
			}
		});

		// Issue 92 (reverse direction): newline-wrapped/unpadded base64 used to
		// fail the strict check and get double-encoded — the server then decoded
		// once and received base64 text instead of the definition bytes.
		it('normalizes wrapped/unpadded base64 instead of double-encoding it', () => {
			// 91 bytes → 124 base64 chars ending in '==', so the unpadded case is real.
			const canonical = Buffer.from(new Uint8Array(91).map((_, i) => i + 1)).toString('base64');
			expect(canonical.endsWith('==')).toBe(true);

			const wrapped = canonical.replace(/(.{20})/g, '$1\r\n');
			expect(prepareGrasshopperArgs(wrapped, []).algo).toBe(canonical);

			const unpadded = canonical.replace(/=+$/, '');
			expect(prepareGrasshopperArgs(unpadded, []).algo).toBe(canonical);
		});

		it('should encode Uint8Array to base64', () => {
			const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
			const dataTree: any[] = [];

			const result = prepareGrasshopperArgs(binaryData, dataTree);

			expect(result.algo).toBeTruthy();
			expect(result.pointer).toBeNull();
			expect(isBase64(result.algo!)).toBe(true);
		});

		it('should preserve data tree values', () => {
			const definition = 'http://example.com/test.gh';
			const dataTree: any[] = [
				{ ParamName: 'Input1', InnerTree: {} },
				{ ParamName: 'Input2', InnerTree: {} }
			];

			const result = prepareGrasshopperArgs(definition, dataTree);

			expect(result.values).toEqual(dataTree);
			expect(result.values).toHaveLength(2);
		});
	});

	describe('applyOptionalComputeSettings', () => {
		const base = (): GrasshopperRequestSchema => ({ algo: null, pointer: null, values: [] });

		it('forwards cacheerroredsolves when set', () => {
			const args = base();
			applyOptionalComputeSettings(args, { serverUrl: 'http://x', cacheerroredsolves: true });
			expect(args.cacheerroredsolves).toBe(true);
		});

		it('omits cacheerroredsolves when unset (back-compat: older servers never see it)', () => {
			const args = base();
			applyOptionalComputeSettings(args, { serverUrl: 'http://x' });
			expect('cacheerroredsolves' in args).toBe(false);
		});

		it('forwards cachesolve and cacheerroredsolves independently', () => {
			const args = base();
			applyOptionalComputeSettings(args, {
				serverUrl: 'http://x',
				cachesolve: true,
				cacheerroredsolves: false
			});
			expect(args.cachesolve).toBe(true);
			expect(args.cacheerroredsolves).toBe(false);
		});
	});

	describe('isBase64', () => {
		it('should return true for valid base64 strings', () => {
			const validBase64 = Buffer.from('Hello World').toString('base64');
			expect(isBase64(validBase64)).toBe(true);
		});

		it('should return false for invalid base64 strings', () => {
			expect(isBase64('not base64!!!')).toBe(false);
			expect(isBase64('plain text')).toBe(false);
			expect(isBase64('')).toBe(false);
		});

		it('should handle edge cases', () => {
			expect(isBase64('=')).toBe(false);
			expect(isBase64('==')).toBe(false);
			expect(isBase64('A')).toBe(false); // Invalid padding
		});

		it('should validate common base64 patterns', () => {
			const tests = [
				{ input: 'SGVsbG8=', expected: true }, // "Hello"
				{ input: 'V29ybGQ=', expected: true }, // "World"
				{ input: 'MTIzNDU2', expected: true }, // "123456"
				{ input: 'not-base64', expected: false }
			];

			tests.forEach(({ input, expected }) => {
				expect(isBase64(input)).toBe(expected);
			});
		});
	});
});
