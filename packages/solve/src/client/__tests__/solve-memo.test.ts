import { describe, expect, it } from 'vitest';
import { createSolveMemo, stableInputKey, type MeshPolicy } from '../solve-memo.js';
import type { SolveResult } from '../../shared/solve-fn.js';

// Pins the client-side result memo: stable keying across key order, LRU recency and
// eviction, hit/miss semantics, clear(), and the injected mesh ownership policy. Driver
// wiring is pinned separately in solve-session.test.ts.
//
// Tests use a fake mesh, not a THREE.Object3D, on purpose: the memo's design is that it
// never learns what a mesh is. If a future change made it reach into a mesh, these tests
// would stop compiling — that's the point. The three.js policy itself is pinned where it
// lives, in `@selvajs/visualization`.

/** A mesh-free result. Generic so it fits a mesh-typed memo too (it just carries no meshes). */
const result = <TMesh = unknown>(tag: string): SolveResult<TMesh> => ({ outputs: { out: tag } });

// ============================================================================
// A fake mesh + policy, standing in for the renderer's clone/dispose rules
// ============================================================================

interface FakeMesh {
	tag: string;
	/** Set by the policy's `release` — the fake's stand-in for a freed GPU buffer. */
	disposed: boolean;
}

const mesh = (tag: string): FakeMesh => ({ tag, disposed: false });

function meshResult(tag: string): SolveResult<FakeMesh> {
	return { outputs: { out: tag }, meshes: [mesh(tag)] };
}

/** Records every release so a test can assert on ownership, not on side effects. */
function trackingPolicy(): MeshPolicy<FakeMesh> & { released: number } {
	const policy = {
		released: 0,
		clone: (meshes: FakeMesh[]) => meshes.map((m) => ({ ...m })),
		release: (meshes: FakeMesh[]) => {
			meshes.forEach((m) => (m.disposed = true));
			policy.released += meshes.length;
		}
	};
	return policy;
}

/** Mirrors a viewer disposing whatever it currently holds on the next scene update. */
function disposeLikeViewer(res: SolveResult<FakeMesh> | undefined): void {
	res?.meshes?.forEach((m) => (m.disposed = true));
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
		const memo = createSolveMemo({ max: 2 });
		memo.set({ k: 1 }, result('1'));
		memo.set({ k: 2 }, result('2'));
		memo.set({ k: 3 }, result('3')); // evicts k:1
		expect(memo.get({ k: 1 })).toBeUndefined();
		expect(memo.get({ k: 2 })).toEqual(result('2'));
		expect(memo.get({ k: 3 })).toEqual(result('3'));
	});

	it('a get refreshes recency, protecting the entry from eviction', () => {
		const memo = createSolveMemo({ max: 2 });
		memo.set({ k: 1 }, result('1'));
		memo.set({ k: 2 }, result('2'));
		memo.get({ k: 1 }); // k:1 now most-recent
		memo.set({ k: 3 }, result('3')); // evicts k:2, not k:1
		expect(memo.get({ k: 1 })).toEqual(result('1'));
		expect(memo.get({ k: 2 })).toBeUndefined();
	});

	it('re-setting an existing key updates the value without growing size', () => {
		const memo = createSolveMemo({ max: 1 });
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

	it('serves meshes by reference when no policy is given (nothing takes ownership)', () => {
		const memo = createSolveMemo<FakeMesh>();
		const stored = meshResult('a');
		memo.set({ k: 1 }, stored);
		expect(memo.get({ k: 1 })!.meshes![0]).toBe(stored.meshes![0]);
	});
});

// The memo caches whole SolveResults, including meshes a viewer disposes on the next
// scene update. Every test above used mesh-free results, so nothing caught that. These
// pin the memo's use of the injected ownership policy.
describe('createSolveMemo — mesh ownership (audit C1)', () => {
	it('serves a usable mesh after the viewer disposed the one it was given', () => {
		const memo = createSolveMemo<FakeMesh>({ meshPolicy: trackingPolicy() });
		memo.set({ k: 1 }, meshResult('a'));

		// Solve 1 renders: the viewer owns and (on the next update) disposes these meshes.
		const first = memo.get({ k: 1 })!;
		disposeLikeViewer(first);

		// Slider returns to the same value → memo hit. The served mesh must be usable,
		// not the corpse the viewer just disposed.
		const second = memo.get({ k: 1 })!;
		expect(second.meshes![0].disposed).toBe(false);
		expect(second.meshes![0]).not.toBe(first.meshes![0]);
	});

	it('never hands the same mesh instance to two consumers', () => {
		// The scene takes ownership of what it is given, so two hits handing out one
		// instance means a double-add and a shared disposal fate.
		const memo = createSolveMemo<FakeMesh>({ meshPolicy: trackingPolicy() });
		memo.set({ k: 1 }, meshResult('a'));
		expect(memo.get({ k: 1 })!.meshes![0]).not.toBe(memo.get({ k: 1 })!.meshes![0]);
	});

	it('clones on the way IN, so the caller disposing its own copy cannot poison the entry', () => {
		const memo = createSolveMemo<FakeMesh>({ meshPolicy: trackingPolicy() });
		const stored = meshResult('a');
		memo.set({ k: 1 }, stored);
		disposeLikeViewer(stored); // the caller reports this same object onward; the viewer eats it
		expect(memo.get({ k: 1 })!.meshes![0].disposed).toBe(false);
	});

	it('preserves non-mesh result fields on a hit', () => {
		const memo = createSolveMemo<FakeMesh>({ meshPolicy: trackingPolicy() });
		memo.set({ k: 1 }, { ...meshResult('a'), errors: ['e'], warnings: ['w'] });
		const hit = memo.get({ k: 1 })!;
		expect(hit.outputs).toEqual({ out: 'a' });
		expect(hit.errors).toEqual(['e']);
		expect(hit.warnings).toEqual(['w']);
	});

	it('releases meshes when an entry is evicted', () => {
		const policy = trackingPolicy();
		const memo = createSolveMemo<FakeMesh>({ max: 1, meshPolicy: policy });
		memo.set({ k: 1 }, meshResult('a'));

		memo.set({ k: 2 }, meshResult('b')); // evicts k:1
		expect(policy.released).toBe(1);
		expect(memo.get({ k: 1 })).toBeUndefined();
	});

	it('releases meshes on clear() (definition switch)', () => {
		const policy = trackingPolicy();
		const memo = createSolveMemo<FakeMesh>({ meshPolicy: policy });
		memo.set({ k: 1 }, meshResult('a'));
		memo.set({ k: 2 }, meshResult('b'));

		memo.clear();
		expect(policy.released).toBe(2);
	});

	it('releases the old value when a key is overwritten', () => {
		const policy = trackingPolicy();
		const memo = createSolveMemo<FakeMesh>({ meshPolicy: policy });
		memo.set({ k: 1 }, meshResult('old'));

		memo.set({ k: 1 }, meshResult('new'));
		expect(policy.released).toBe(1);
		expect(memo.get({ k: 1 })!.outputs).toEqual({ out: 'new' });
	});

	it('handles mesh-free results without touching the policy', () => {
		const policy = trackingPolicy();
		const memo = createSolveMemo<FakeMesh>({ max: 1, meshPolicy: policy });
		memo.set({ k: 1 }, result('1'));
		memo.set({ k: 2 }, result('2')); // evicts k:1 — must not throw
		expect(memo.get({ k: 2 })).toEqual(result('2'));
		expect(policy.released).toBe(0);
	});
});
