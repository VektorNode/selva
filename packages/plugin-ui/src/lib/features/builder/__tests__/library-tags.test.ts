import { describe, expect, it } from 'vitest';
import { MAX_TAGS } from '@selvajs/schemas';
import { addTags } from '../library-tags';

describe('addTags', () => {
	it('splits on commas, trims, and skips blanks and duplicates', () => {
		expect(addTags(['facade'], ' steel, facade,, timber ')).toEqual(['facade', 'steel', 'timber']);
	});

	it('stops at the tag limit', () => {
		const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
		expect(addTags(full, 'one more')).toEqual(full);
		expect(addTags(full.slice(1), 'a, b')).toEqual([...full.slice(1), 'a']);
	});
});
