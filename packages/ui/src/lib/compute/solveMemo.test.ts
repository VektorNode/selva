import { describe, expect, it } from 'vitest';
import { createSolveMemo, stableInputKey } from './solveMemo';
import type { SolveResult } from '../types/solveFn';

// Pins the client-side result memo (M2): stable keying across key order, LRU recency and
// eviction, hit/miss semantics, and clear(). The driver wiring is pinned separately in
// createSolveSession.test.ts.

const result = (tag: string): SolveResult => ({ outputs: { out: tag } });

describe('stableInputKey', () => {
	it('is insensitive to object key order', () => {
		expect(stableInputKey({ a: 1, b: 2 })).toBe(stableInputKey({ b: 2, a: 1 }));
	});

	it('sorts keys at every level (nested objects)', () => {
		expect(stableInputKey({ o: { x: 1, y: 2 } })).toBe(stableInputKey({ o: { y: 2, x: 1 } }));
	});

	it('distinguishes different values', () => {
		expect(stableInputKey({ a: 1 })).not.toBe(stableInputKey({ a: 2 }));
	});

	it('preserves array order (arrays are ordered)', () => {
		expect(stableInputKey({ a: [1, 2] })).not.toBe(stableInputKey({ a: [2, 1] }));
	});

	it('handles null and primitive values', () => {
		expect(stableInputKey({ a: null, b: 'x', c: true })).toBe(
			stableInputKey({ c: true, b: 'x', a: null })
		);
	});
});

describe('createSolveMemo', () => {
	it('returns undefined on a miss', () => {
		const memo = createSolveMemo();
		expect(memo.get({ a: 1 })).toBeUndefined();
	});

	it('round-trips a stored result by equal inputs regardless of key order', () => {
		const memo = createSolveMemo();
		memo.set({ a: 1, b: 2 }, result('r'));
		expect(memo.get({ b: 2, a: 1 })).toEqual(result('r'));
	});

	it('caches errored results (a complete, deterministic solve outcome)', () => {
		const memo = createSolveMemo();
		const errored: SolveResult = { outputs: {}, errors: ['boom'] };
		memo.set({ a: 1 }, errored);
		expect(memo.get({ a: 1 })).toEqual(errored);
	});

	it('evicts the least-recently-used entry past capacity', () => {
		const memo = createSolveMemo(2);
		memo.set({ k: 1 }, result('1'));
		memo.set({ k: 2 }, result('2'));
		memo.set({ k: 3 }, result('3')); // evicts k:1
		expect(memo.get({ k: 1 })).toBeUndefined();
		expect(memo.get({ k: 2 })).toEqual(result('2'));
		expect(memo.get({ k: 3 })).toEqual(result('3'));
	});

	it('a get refreshes recency, protecting the entry from eviction', () => {
		const memo = createSolveMemo(2);
		memo.set({ k: 1 }, result('1'));
		memo.set({ k: 2 }, result('2'));
		memo.get({ k: 1 }); // k:1 now most-recent
		memo.set({ k: 3 }, result('3')); // evicts k:2, not k:1
		expect(memo.get({ k: 1 })).toEqual(result('1'));
		expect(memo.get({ k: 2 })).toBeUndefined();
	});

	it('re-setting an existing key updates the value without growing size', () => {
		const memo = createSolveMemo(1);
		memo.set({ k: 1 }, result('old'));
		memo.set({ k: 1 }, result('new'));
		expect(memo.get({ k: 1 })).toEqual(result('new'));
	});

	it('clear() drops every entry', () => {
		const memo = createSolveMemo();
		memo.set({ a: 1 }, result('r'));
		memo.clear();
		expect(memo.get({ a: 1 })).toBeUndefined();
	});
});
