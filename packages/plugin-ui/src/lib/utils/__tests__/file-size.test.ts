import { describe, expect, it } from 'vitest';
import { formatFileSize } from '../file-size';

describe('formatFileSize', () => {
	it('picks the largest unit below 1000', () => {
		expect(formatFileSize(512, 'en')).toBe('512 bytes');
		expect(formatFileSize(182044, 'en')).toBe('182 kB');
		expect(formatFileSize(1_500_000, 'en')).toBe('1.5 MB');
		expect(formatFileSize(2_000_000_000, 'en')).toBe('2 GB');
	});
});
