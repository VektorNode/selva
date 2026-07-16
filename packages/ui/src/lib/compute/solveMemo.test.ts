import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSolveMemo, stableInputKey } from './solveMemo';
import type { SolveResult } from '../types/solveFn';

// Pins the client-side result memo (M2): stable keying across key order, LRU recency and
// eviction, hit/miss semantics, and clear(). The driver wiring is pinned separately in
// createSolveSession.test.ts.

const result = (tag: string): SolveResult => ({ outputs: { out: tag } });

/** A mesh-bearing result — the shape that exposed audit C1. */
function meshResult(tag: string): SolveResult {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
	mesh.name = tag;
	return { outputs: { out: tag }, meshes: [mesh] };
}

/** Mirrors `clearScene`'s disposal of whatever the viewer currently holds. */
function disposeLikeViewer(res: SolveResult | undefined): void {
	res?.meshes?.forEach((m: THREE.Object3D) =>
		m.traverse((child) => {
			const r = child as Partial<THREE.Mesh> & THREE.Object3D;
			r.geometry?.dispose();
			const mat = r.material;
			if (!mat) return;
			(Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
		})
	);
}

/**
 * Count `dispose()` calls across ALL geometries for the duration of a test.
 *
 * The memo stores a private clone, so watching the object handed to `set` would prove
 * nothing — the retained copy is deliberately unreachable. Spying the prototype observes
 * disposal of whichever instance the memo actually owns, which is the real invariant:
 * an entry leaving the map must release its buffers.
 */
function countDisposals(): { count: () => number; restore: () => void } {
	const original = THREE.BufferGeometry.prototype.dispose;
	let n = 0;
	THREE.BufferGeometry.prototype.dispose = function (this: THREE.BufferGeometry) {
		n++;
		return original.call(this);
	};
	return {
		count: () => n,
		restore: () => {
			THREE.BufferGeometry.prototype.dispose = original;
		}
	};
}

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

// Audit C1. The memo caches whole SolveResults, including live three.js objects, but the
// viewer's `clearScene` disposes the meshes it is handed on the next scene update. Every
// pre-existing test above used mesh-free results, so nothing caught it.
describe('createSolveMemo — GPU object ownership (audit C1)', () => {
	it('serves a usable mesh after the viewer disposed the one it was given', () => {
		const memo = createSolveMemo();
		const stored = meshResult('a');
		memo.set({ k: 1 }, stored);

		// Solve 1 renders: the viewer owns and (on the next update) disposes these meshes.
		const first = memo.get({ k: 1 })!;
		disposeLikeViewer(first);

		// Slider returns to the same value → memo hit. The served mesh must be renderable,
		// not the corpse the viewer just disposed.
		const second = memo.get({ k: 1 })!;
		const geo = (second.meshes![0] as THREE.Mesh).geometry;
		expect(geo.attributes.position).toBeDefined();
		expect(second.meshes![0]).not.toBe(first.meshes![0]);
	});

	it('never hands the same mesh instance to two consumers', () => {
		// The scene takes ownership of what it is given (updateScene → scene.add), so two
		// hits handing out one instance means a double-add and a shared disposal fate.
		const memo = createSolveMemo();
		memo.set({ k: 1 }, meshResult('a'));
		expect(memo.get({ k: 1 })!.meshes![0]).not.toBe(memo.get({ k: 1 })!.meshes![0]);
	});

	it('preserves non-mesh result fields on a hit', () => {
		const memo = createSolveMemo();
		const stored: SolveResult = { ...meshResult('a'), errors: ['e'], warnings: ['w'] };
		memo.set({ k: 1 }, stored);
		const hit = memo.get({ k: 1 })!;
		expect(hit.outputs).toEqual({ out: 'a' });
		expect(hit.errors).toEqual(['e']);
		expect(hit.warnings).toEqual(['w']);
	});

	it('releases GPU memory when an entry is evicted', () => {
		const memo = createSolveMemo(1);
		memo.set({ k: 1 }, meshResult('a'));

		const spy = countDisposals();
		try {
			memo.set({ k: 2 }, meshResult('b')); // evicts k:1
			expect(spy.count()).toBe(1);
		} finally {
			spy.restore();
		}
		expect(memo.get({ k: 1 })).toBeUndefined();
	});

	it('releases GPU memory on clear() (definition switch)', () => {
		const memo = createSolveMemo();
		memo.set({ k: 1 }, meshResult('a'));
		memo.set({ k: 2 }, meshResult('b'));

		const spy = countDisposals();
		try {
			memo.clear();
			expect(spy.count()).toBe(2);
		} finally {
			spy.restore();
		}
	});

	it('releases the old value when a key is overwritten', () => {
		const memo = createSolveMemo();
		memo.set({ k: 1 }, meshResult('old'));

		const spy = countDisposals();
		try {
			memo.set({ k: 1 }, meshResult('new'));
			expect(spy.count()).toBe(1);
		} finally {
			spy.restore();
		}
		expect(memo.get({ k: 1 })!.outputs).toEqual({ out: 'new' });
	});

	it('handles mesh-free results without touching disposal paths', () => {
		const memo = createSolveMemo(1);
		memo.set({ k: 1 }, result('1'));
		memo.set({ k: 2 }, result('2')); // evicts k:1 — must not throw
		expect(memo.get({ k: 2 })).toEqual(result('2'));
	});
});
