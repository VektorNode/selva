import { describe, it, expect } from 'vitest';
import { applyOptionalComputeSettings, prepareGrasshopperArgs } from '../solve';
import type { DataTree, GrasshopperRequestSchema } from '../types';

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

describe('solve', () => {
	describe('prepareGrasshopperArgs', () => {
		it('should handle URL definition as pointer', () => {
			const definition = 'https://example.com/definition.gh';
			const dataTree: DataTree[] = [];

			const result = prepareGrasshopperArgs(definition, dataTree);

			expect(result.pointer).toBe(definition);
			expect(result.algo).toBeNull();
			expect(result.values).toEqual(dataTree);
		});

		it('should encode plain string definition to base64', () => {
			const definition = 'plain text definition';
			const dataTree: DataTree[] = [];

			const result = prepareGrasshopperArgs(definition, dataTree);

			expect(result.algo).toBeTruthy();
			expect(result.pointer).toBeNull();
			expect(result.algo).toMatch(BASE64);
		});

		it('should pass through existing base64 string (realistic definition-sized input)', () => {
			// Real definitions are KB–MB; the detection floor is 64 base64 chars.
			const base64Definition = Buffer.from(
				new Uint8Array(256).map((_, i) => (i * 7 + 3) & 0xff)
			).toString('base64');
			const dataTree: DataTree[] = [];

			const result = prepareGrasshopperArgs(base64Definition, dataTree);

			expect(result.algo).toBe(base64Definition);
			expect(result.pointer).toBeNull();
		});

		// Sent raw, a short base64-shaped string ("test", "dGVzdA==") would be decoded by the
		// server into garbage instead of being treated as the plain string it is.
		it('encodes short base64-shaped strings as plain text', () => {
			for (const definition of ['test', 'Data2024', Buffer.from('test').toString('base64')]) {
				const result = prepareGrasshopperArgs(definition, []);
				expect(result.algo).toBe(Buffer.from(definition, 'utf-8').toString('base64'));
				expect(result.pointer).toBeNull();
			}
		});

		// Double-encoded, wrapped/unpadded base64 would reach the server as base64 text, not bytes.
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
			const dataTree: DataTree[] = [];

			const result = prepareGrasshopperArgs(binaryData, dataTree);

			expect(result.algo).toBeTruthy();
			expect(result.pointer).toBeNull();
			expect(result.algo).toMatch(BASE64);
		});

		it('should preserve data tree values', () => {
			const definition = 'http://example.com/test.gh';
			const dataTree: DataTree[] = [
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
});
