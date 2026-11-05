import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PAGE_LIMIT,
	MAX_PAGE_LIMIT,
	clampPageLimit,
	decodeOffsetCursor,
	encodeOffsetCursor,
	listAll,
	walkPages
} from '../pagination.js';

describe('offset cursors', () => {
	it('round-trips', () => {
		expect(decodeOffsetCursor(encodeOffsetCursor(40))).toBe(40);
	});

	it.each([undefined, '', 'junk', '-5'])('reads %j as the first page', (cursor) => {
		expect(decodeOffsetCursor(cursor)).toBe(0);
	});
});

describe('listAll and walkPages', () => {
	const pages = [
		{ items: [1, 2], nextCursor: 'b' },
		{ items: [3], nextCursor: 'c' },
		{ items: [4] }
	];
	function fetcher() {
		const asked: { limit: number; cursor?: string }[] = [];
		const fetchPage = async (page: { limit: number; cursor?: string }) => {
			asked.push(page);
			return pages[asked.length - 1]!;
		};
		return { asked, fetchPage };
	}

	it('collects every row, following each cursor at the largest page size', async () => {
		const { asked, fetchPage } = fetcher();

		await expect(listAll(fetchPage)).resolves.toEqual([1, 2, 3, 4]);

		expect(asked).toEqual([
			{ limit: MAX_PAGE_LIMIT, cursor: undefined },
			{ limit: MAX_PAGE_LIMIT, cursor: 'b' },
			{ limit: MAX_PAGE_LIMIT, cursor: 'c' }
		]);
	});

	it('reads no further than the page a caller stops at', async () => {
		const { asked, fetchPage } = fetcher();

		for await (const page of walkPages(fetchPage)) {
			if (page.items.includes(2)) break;
		}

		expect(asked).toHaveLength(1);
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
