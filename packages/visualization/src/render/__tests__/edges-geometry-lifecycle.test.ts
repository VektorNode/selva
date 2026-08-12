import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { addEdges, isEdgeOverlay, removeEdges } from '../edges.js';
import { clearScene } from '../three-helpers.js';

// ============================================================================
// Edge line-geometry lifecycle
// ============================================================================
//
// Replaces the F1 leak suite (edges-cache-growth.test.ts, removed 2026-07-30 with the
// identity cache it tested). The leak was: whole-scene clears bypassed `removeEdges`, so a
// refcounted cache never released its `LineSegmentsGeometry` and GPU buffers accumulated
// without bound — 400 live entries where 8 were expected.
//
// The cache is gone; each overlay now owns its line geometry outright. These tests pin the
// invariant that makes the leak structurally impossible: every overlay geometry created by
// `addEdges` is disposed by BOTH teardown paths.

const THRESHOLD = 44;

/** Box, not sphere: a smooth sphere has no crease above 44°, so it yields zero segments. */
function makeMesh(): THREE.Mesh {
	return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
}

function overlaysUnder(root: THREE.Object3D): LineSegments2[] {
	const found: LineSegments2[] = [];
	root.traverse((object) => {
		if (isEdgeOverlay(object)) found.push(object as LineSegments2);
	});
	return found;
}

/** Spy every overlay geometry's dispose, returning a count of how many have been called. */
function watchDisposals(root: THREE.Object3D): () => number {
	const spies = overlaysUnder(root).map((overlay) => vi.spyOn(overlay.geometry, 'dispose'));
	return () => spies.filter((spy) => spy.mock.calls.length > 0).length;
}

describe('edge overlay geometry lifecycle', () => {
	it('clearScene disposes every overlay line geometry', () => {
		const scene = new THREE.Scene();
		const root = new THREE.Group();
		for (let i = 0; i < 8; i++) root.add(makeMesh());
		scene.add(root);

		addEdges(root, { thresholdAngle: THRESHOLD });
		const created = overlaysUnder(root).length;
		expect(created).toBe(8);

		const disposedCount = watchDisposals(root);
		clearScene(scene);

		// The path that leaked under the old cache: overlays are detached wholesale, never via
		// removeEdges. They are children of their meshes, so the dispose walker reaches them.
		expect(disposedCount()).toBe(created);
	});

	it('removeEdges disposes every overlay line geometry', () => {
		const root = new THREE.Group();
		for (let i = 0; i < 4; i++) root.add(makeMesh());

		addEdges(root, { thresholdAngle: THRESHOLD });
		const created = overlaysUnder(root).length;
		expect(created).toBe(4);

		const disposedCount = watchDisposals(root);
		expect(removeEdges(root)).toBe(created);
		expect(disposedCount()).toBe(created);
	});

	it('meshes sharing one source geometry get independent, separately-disposed overlays', () => {
		// Under the old cache these shared one refcounted LineSegmentsGeometry — the aliasing that
		// made disposal order load-bearing. Now each overlay owns its own.
		const shared = new THREE.BoxGeometry(1, 1, 1);
		const root = new THREE.Group();
		root.add(new THREE.Mesh(shared, new THREE.MeshStandardMaterial()));
		root.add(new THREE.Mesh(shared, new THREE.MeshStandardMaterial()));

		addEdges(root, { thresholdAngle: THRESHOLD });
		const overlays = overlaysUnder(root);
		expect(overlays).toHaveLength(2);
		expect(overlays[0]!.geometry).not.toBe(overlays[1]!.geometry);

		const disposedCount = watchDisposals(root);
		removeEdges(root);
		expect(disposedCount()).toBe(2);
	});

	it('repeated solve cycles leave no overlay geometry undisposed', () => {
		const scene = new THREE.Scene();
		const shared = [0, 1, 2, 3].map(() => new THREE.BoxGeometry(1, 1, 1));

		let createdTotal = 0;
		let disposedTotal = 0;

		for (let solve = 0; solve < 20; solve++) {
			const root = new THREE.Group();
			for (const geometry of shared) {
				root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
			}
			scene.add(root);

			addEdges(root, { thresholdAngle: THRESHOLD });
			createdTotal += overlaysUnder(root).length;

			const disposedCount = watchDisposals(root);
			clearScene(scene);
			disposedTotal += disposedCount();
		}

		// 4 meshes x 20 solves, every one released. The F1 leak showed up exactly here: the
		// source geometries stay reachable across solves (the cross-solve geometry cache keeps
		// them), which is what made the old WeakMap's reachability premise false.
		expect(createdTotal).toBe(80);
		expect(disposedTotal).toBe(80);
	});
});
