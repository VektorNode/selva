/**
 * `paginate`'s cursor is a **raw offset** — a deliberate single-node tradeoff
 * with a well-known failure mode: when the underlying list changes between
 * page fetches, the offset points somewhere different than the caller thinks.
 *
 * Two tests below **characterize** that rather than assert it away (`SKIPS` /
 * `DUPLICATES`), so a future move to a keyset cursor turns them red instead of
 * silently going stale. Default ordering is newest-first (`createdAt desc`),
 * so a newly-created row lands on page 1 and pushes everything down — that's
 * the common case, and it's the skip direction that matters (an item a caller
 * never sees, vs. one they see twice).
 */

import { describe, it, expect } from 'vitest';
import { paginate, applyOrder } from '../pagination.js';

/** Items are plain ids; `paginate` is agnostic to their shape. */
const items = (n: number, prefix = 'i'): string[] =>
	Array.from({ length: n }, (_, k) => `${prefix}${k}`);

/** Walk every page, following nextCursor. Returns the concatenated ids. */
function drain(source: () => string[], limit: number): string[] {
	const seen: string[] = [];
	let cursor: string | undefined;
	for (let guard = 0; guard < 100; guard++) {
		const page = paginate(source(), { limit, cursor });
		seen.push(...page.items);
		if (!page.nextCursor) return seen;
		cursor = page.nextCursor;
	}
	throw new Error('drain did not terminate');
}

describe('paginate — basics', () => {
	it('returns the first page and a cursor when more remain', () => {
		const page = paginate(items(10), { limit: 3 });
		expect(page.items).toEqual(['i0', 'i1', 'i2']);
		expect(page.nextCursor).toBe('3');
	});

	it('omits nextCursor on the exact final boundary', () => {
		const page = paginate(items(9), { limit: 3, cursor: '6' });
		expect(page.items).toEqual(['i6', 'i7', 'i8']);
		expect(page.nextCursor).toBeUndefined();
	});

	it('returns an empty final page with no cursor when the offset is past the end', () => {
		const page = paginate(items(5), { limit: 3, cursor: '99' });
		expect(page.items).toEqual([]);
		expect(page.nextCursor).toBeUndefined();
	});

	it('walks every item exactly once over a stable list', () => {
		const stable = items(10);
		expect(drain(() => stable, 3)).toEqual(stable);
	});

	it('handles an empty list', () => {
		const page = paginate([], { limit: 10 });
		expect(page.items).toEqual([]);
		expect(page.nextCursor).toBeUndefined();
	});
});

describe('paginate — limit clamping', () => {
	it('clamps a limit below 1 up to 1', () => {
		expect(paginate(items(5), { limit: 0 }).items).toHaveLength(1);
		expect(paginate(items(5), { limit: -10 }).items).toHaveLength(1);
	});

	it('clamps an oversized limit down to MAX_PAGE_LIMIT (200)', () => {
		expect(paginate(items(500), { limit: 10_000 }).items).toHaveLength(200);
	});

	it('defaults to DEFAULT_PAGE_LIMIT (50) when no limit is given', () => {
		expect(paginate(items(500)).items).toHaveLength(50);
	});
});

describe('paginate — hostile cursors are tolerated, never throw', () => {
	it.each([
		['garbage', 'not-a-number'],
		['empty string', ''],
		['zero', '0'],
		['float', '2.9'],
		['whitespace', '   ']
	])('treats a %s cursor as a safe offset', (_label, cursor) => {
		const page = paginate(items(5), { limit: 2, cursor });
		expect(page.items.length).toBeGreaterThan(0);
		expect(page.items.every((i) => i.startsWith('i'))).toBe(true);
	});

	it('does NOT read from the tail on a negative cursor', () => {
		// REGRESSION: `parseInt('-5') || 0` kept -5, which reached `Array.slice(-5)`
		// and served the LAST five rows to a caller asking for page one — a silent
		// wrong-window read on any attacker- or client-supplied cursor.
		const page = paginate(items(10), { limit: 3, cursor: '-5' });
		expect(page.items).toEqual(['i0', 'i1', 'i2']);
		expect(paginate(items(10), { limit: 3, cursor: '-999' }).items).toEqual(['i0', 'i1', 'i2']);
	});
});

describe('paginate — stability under concurrent modification (offset-cursor tradeoff)', () => {
	it('CHARACTERIZATION: an insertion at the head DUPLICATES an item across pages', () => {
		// Real sequence: fetch page 1, someone creates a definition (sorts to the
		// head under `createdAt desc`), fetch page 2 with the offset cursor.
		// Everything shifted right by one, so offset 3 now points at an item
		// page 1 already returned — the caller sees it twice.
		const list = items(6); // i0..i5
		const first = paginate(list, { limit: 3 });
		expect(first.items).toEqual(['i0', 'i1', 'i2']);

		list.unshift('NEW'); // now: NEW, i0, i1, i2, i3, i4, i5
		const second = paginate(list, { limit: 3, cursor: first.nextCursor });

		expect(second.items).toEqual(['i2', 'i3', 'i4']);
		// i2 served twice. Duplication is the benign direction — deletion (next
		// test) causes a skip instead, which is the harmful one.
		expect(first.items.concat(second.items).filter((i) => i === 'i2')).toHaveLength(2);
	});

	it('CHARACTERIZATION: a deletion before the cursor SKIPS an item entirely', () => {
		// Delete anything from page 1 and everything after it shifts left, so the
		// offset jumps over the row that slid into the boundary — the dangerous
		// direction: an item the caller never sees.
		const list = items(6); // i0..i5
		const first = paginate(list, { limit: 3 });
		expect(first.items).toEqual(['i0', 'i1', 'i2']);

		list.splice(0, 1); // i0 deleted → i1, i2, i3, i4, i5
		// Offset 3 now points at i4 — i3 is never returned by either page.
		const second = paginate(list, { limit: 3, cursor: first.nextCursor });
		expect(second.items).toEqual(['i4', 'i5']);
		const walked = first.items.concat(second.items);
		expect(walked).not.toContain('i3');
	});

	it('is stable when the list does not change between pages', () => {
		// The guarantee callers actually rely on, as opposed to the two above.
		const list = items(7);
		const walked = drain(() => list, 2);
		expect(walked).toEqual(list);
		expect(new Set(walked).size).toBe(7);
	});
});

describe('applyOrder', () => {
	interface Row {
		id: string;
		createdAt: string;
		name?: string;
	}
	const rows = (): Row[] => [
		{ id: 'b', createdAt: '2026-01-02', name: 'Beta' },
		{ id: 'a', createdAt: '2026-01-03', name: 'Alpha' },
		{ id: 'c', createdAt: '2026-01-01', name: 'Gamma' }
	];

	it('defaults to createdAt descending (newest first)', () => {
		expect(applyOrder(rows()).map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});

	it('honors orderBy + orderDir', () => {
		expect(applyOrder(rows(), { orderBy: 'createdAt', orderDir: 'asc' }).map((r) => r.id)).toEqual([
			'c',
			'b',
			'a'
		]);
		expect(applyOrder(rows(), { orderBy: 'name', orderDir: 'asc' }).map((r) => r.id)).toEqual([
			'a',
			'b',
			'c'
		]);
	});

	it('sorts IN PLACE — callers must not pass a shared array they still need', () => {
		// A caller handing over a cached array would have that cache reordered underneath it.
		const original = rows();
		const returned = applyOrder(original, { orderBy: 'name', orderDir: 'asc' });
		expect(returned).toBe(original);
		expect(original.map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});

	it('treats a nullish sort key as empty rather than throwing', () => {
		const withMissing: Row[] = [
			{ id: 'x', createdAt: '2026-01-01' },
			{ id: 'y', createdAt: '2026-01-02', name: 'Named' }
		];
		expect(() => applyOrder(withMissing, { orderBy: 'name', orderDir: 'asc' })).not.toThrow();
		expect(applyOrder(withMissing, { orderBy: 'name', orderDir: 'asc' })[0].id).toBe('x');
	});

	it('supports a custom keyFn (e.g. case-folded names)', () => {
		const mixed: Row[] = [
			{ id: 'upper', createdAt: '2026-01-01', name: 'apple' },
			{ id: 'lower', createdAt: '2026-01-02', name: 'Banana' }
		];
		// Without folding, 'Banana' < 'apple' by code unit (uppercase sorts first).
		const sorted = applyOrder(mixed, { orderBy: 'name', orderDir: 'asc' }, (item, field) =>
			String((item as unknown as Record<string, unknown>)[field] ?? '').toLowerCase()
		);
		expect(sorted.map((r) => r.id)).toEqual(['upper', 'lower']);
	});
});
