import { describe, expect, it, vi } from 'vitest';
import { createSelectionState } from '../selection.js';

const CLICK = { shiftKey: false, toggleKey: false };
const CTRL = { shiftKey: false, toggleKey: true };
const SHIFT = { shiftKey: true, toggleKey: false };
const CTRL_SHIFT = { shiftKey: true, toggleKey: true };

const flat = ['a', 'b', 'c', 'd', 'e'];
const order = () => flat;

describe('createSelectionState', () => {
	it('a plain click replaces the selection and moves the anchor', () => {
		const state = createSelectionState();

		state.select('a', CLICK, order);
		state.select('c', CLICK, order);

		expect([...state.selected]).toEqual(['c']);
		expect(state.anchor).toBe('c');
	});

	it('ctrl-click adds without clearing', () => {
		const state = createSelectionState();

		state.select('a', CLICK, order);
		state.select('c', CTRL, order);

		expect([...state.selected].sort()).toEqual(['a', 'c']);
	});

	it('ctrl-click on a selected item deselects it', () => {
		const state = createSelectionState();
		state.select('a', CLICK, order);

		state.select('a', CTRL, order);

		expect(state.selected.size).toBe(0);
	});

	it('shift-click selects the inclusive range from the anchor', () => {
		const state = createSelectionState();
		state.select('b', CLICK, order);

		state.select('d', SHIFT, order);

		expect([...state.selected].sort()).toEqual(['b', 'c', 'd']);
	});

	it('shift-click ranges backwards too', () => {
		const state = createSelectionState();
		state.select('d', CLICK, order);

		state.select('b', SHIFT, order);

		expect([...state.selected].sort()).toEqual(['b', 'c', 'd']);
	});

	it('plain shift replaces the previous selection', () => {
		const state = createSelectionState();
		state.select('a', CLICK, order);
		state.select('e', CTRL, order);
		state.select('b', CLICK, order);

		state.select('c', SHIFT, order);

		expect([...state.selected].sort()).toEqual(['b', 'c']);
	});

	it('ctrl-shift extends rather than replacing', () => {
		const state = createSelectionState();
		state.select('e', CLICK, order);
		state.select('a', CLICK, order);

		state.select('c', CTRL_SHIFT, order);

		expect([...state.selected].sort()).toEqual(['a', 'b', 'c']);
	});

	it('keeps the anchor put across shift-clicks so the range pivots', () => {
		const state = createSelectionState();
		state.select('b', CLICK, order);

		state.select('d', SHIFT, order);
		state.select('c', SHIFT, order);

		expect(state.anchor).toBe('b');
		expect([...state.selected].sort()).toEqual(['b', 'c']);
	});

	it('shift with no anchor behaves like a plain click', () => {
		const state = createSelectionState();

		state.select('c', SHIFT, order);

		expect([...state.selected]).toEqual(['c']);
	});

	it('leaves the selection alone when the anchor scrolled out of the visible order', () => {
		const state = createSelectionState();
		state.select('a', CLICK, order);

		state.select('c', SHIFT, () => ['c', 'd']);

		expect([...state.selected]).toEqual(['a']);
	});

	it('clear empties the selection and drops the anchor', () => {
		const state = createSelectionState();
		state.select('a', CLICK, order);

		state.clear();

		expect(state.selected.size).toBe(0);
		expect(state.anchor).toBeNull();
	});

	it('reports anchor moves to subscribers', () => {
		const listener = vi.fn();
		const state = createSelectionState();
		state.onAnchorChange(listener);

		state.select('a', CLICK, order);
		state.clear();

		expect(listener).toHaveBeenNthCalledWith(1, 'a');
		expect(listener).toHaveBeenNthCalledWith(2, null);
	});

	it('stops reporting after unsubscribe', () => {
		const listener = vi.fn();
		const state = createSelectionState();
		const unsubscribe = state.onAnchorChange(listener);

		unsubscribe();
		state.select('a', CLICK, order);

		expect(listener).not.toHaveBeenCalled();
	});
});
