import { describe, expect, it } from 'vitest';
import { withCacheBust } from '../cacheBust.js';

describe('withCacheBust', () => {
	it('puts the token before a fragment', () => {
		expect(withCacheBust('/a#f', 1)).toBe('/a?v=1#f');
		expect(withCacheBust('/a?x=1#f', 1)).toBe('/a?x=1&v=1#f');
	});

	it('appends to a plain URL', () => {
		expect(withCacheBust('/a', 'b c')).toBe('/a?v=b%20c');
	});
});
