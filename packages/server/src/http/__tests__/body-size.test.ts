import { describe, it, expect } from 'vitest';
import { declaredBodySizeExceeds } from '../body-size.js';

function headersWith(contentLength?: string): Headers {
	const h = new Headers();
	if (contentLength !== undefined) h.set('content-length', contentLength);
	return h;
}

describe('declaredBodySizeExceeds', () => {
	it('flags a declared size over the limit', () => {
		expect(declaredBodySizeExceeds(headersWith('1001'), 1000)).toBe(true);
	});

	it('passes a declared size at or under the limit', () => {
		expect(declaredBodySizeExceeds(headersWith('1000'), 1000)).toBe(false);
		expect(declaredBodySizeExceeds(headersWith('0'), 1000)).toBe(false);
	});

	it('passes when Content-Length is absent (chunked transfer — global limit is the backstop)', () => {
		expect(declaredBodySizeExceeds(headersWith(), 1000)).toBe(false);
	});

	it('passes a non-numeric Content-Length rather than throwing', () => {
		expect(declaredBodySizeExceeds(headersWith('not-a-number'), 1000)).toBe(false);
	});
});
