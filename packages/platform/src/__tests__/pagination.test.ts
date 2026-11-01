import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PAGE_LIMIT,
	MAX_PAGE_LIMIT,
	clampPageLimit,
	decodeOffsetCursor,
	encodeOffsetCursor
} from '../pagination.js';

describe('offset cursors', () => {
	it('round-trips', () => {
		expect(decodeOffsetCursor(encodeOffsetCursor(40))).toBe(40);
	});

	it.each([undefined, '', 'junk', '-5'])('reads %j as the first page', (cursor) => {
		expect(decodeOffsetCursor(cursor)).toBe(0);
	});
});

describe('clampPageLimit', () => {
	it.each([
		[undefined, DEFAULT_PAGE_LIMIT],
		[Number.NaN, DEFAULT_PAGE_LIMIT],
		[0, 1],
		[0.5, 1],
		[10.9, 10],
		[MAX_PAGE_LIMIT + 1, MAX_PAGE_LIMIT]
	])('turns %s into %s', (requested, expected) => {
		expect(clampPageLimit(requested)).toBe(expected);
	});
});
