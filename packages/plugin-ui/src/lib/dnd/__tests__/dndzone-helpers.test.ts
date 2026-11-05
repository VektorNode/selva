import { describe, expect, it } from 'vitest';
import { draggedItemMove } from '../dndzone-helpers';

function applyMove(ids: string[], move: { from: number; to: number }): string[] {
	const next = [...ids];
	const [moved] = next.splice(move.from, 1);
	next.splice(move.to, 0, moved);
	return next;
}

describe('draggedItemMove', () => {
	it('moves an item forward by two slots', () => {
		const oldIds = ['A', 'B', 'C'];
		const newIds = ['B', 'C', 'A'];
		const move = draggedItemMove(oldIds, newIds, 'A');

		expect(move).toEqual({ from: 0, to: 2 });
		expect(applyMove(oldIds, move!)).toEqual(newIds);
	});

	it('moves an item backward', () => {
		const oldIds = ['A', 'B', 'C', 'D'];
		const newIds = ['A', 'D', 'B', 'C'];
		const move = draggedItemMove(oldIds, newIds, 'D');

		expect(move).toEqual({ from: 3, to: 1 });
		expect(applyMove(oldIds, move!)).toEqual(newIds);
	});

	it('returns null when the item is dropped where it started', () => {
		expect(draggedItemMove(['A', 'B', 'C'], ['A', 'B', 'C'], 'B')).toBeNull();
	});

	it('returns null when the dragged id is not in both orders', () => {
		expect(draggedItemMove(['A', 'B'], ['A', 'B', 'X'], 'X')).toBeNull();
	});
});
