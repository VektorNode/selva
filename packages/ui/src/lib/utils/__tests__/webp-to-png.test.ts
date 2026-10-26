import { describe, expect, it } from 'vitest';
import { shouldConvertWebp } from '../webp-to-png';

describe('shouldConvertWebp', () => {
	const imageFormats = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

	it('converts a WebP for an input that also takes PNG', () => {
		expect(shouldConvertWebp('.webp', imageFormats)).toBe(true);
	});

	it('leaves a WebP alone when PNG is not an accepted value', () => {
		expect(shouldConvertWebp('.webp', ['.webp'])).toBe(false);
		expect(shouldConvertWebp('.webp', [])).toBe(false);
	});

	it('leaves other formats alone', () => {
		expect(shouldConvertWebp('.png', imageFormats)).toBe(false);
		expect(shouldConvertWebp('.jpg', imageFormats)).toBe(false);
	});
});
