import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { describe, expect, it } from 'vitest';

import {
	EDGES_SKIPPED_OVERLAY_BUDGET,
	EDGES_SKIPPED_TRIANGLE_CAP,
	addEdges,
	addEdgesAsync,
	removeEdges
} from '../edges';

function meshWithBox(size = 1): THREE.Mesh {
	return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial());
}

function overlaysOf(mesh: THREE.Mesh): LineSegments2[] {
	return mesh.children.filter((c): c is LineSegments2 => c instanceof LineSegments2);
}

describe('addEdgesAsync', () => {
	// In this environment there is no Worker, so extraction runs inline — but attachment still
	// resolves through a microtask, which is exactly the race window the cancellation guards cover.

	it('attaches overlays to every mesh once resolved', async () => {
		const root = new THREE.Group();
		const meshA = meshWithBox();
		const meshB = meshWithBox();
		root.add(meshA, meshB);

		const created = await addEdgesAsync(root);

		expect(created).toHaveLength(2);
		expect(overlaysOf(meshA)).toHaveLength(1);
		expect(overlaysOf(meshB)).toHaveLength(1);
	});

	it('removeEdges called while an apply is in flight cancels its attaches', async () => {
		const root = new THREE.Group();
		const mesh = meshWithBox();
		root.add(mesh);

		const pending = addEdgesAsync(root);
		removeEdges(root); // bumps the root generation before the microtask attach lands

		const created = await pending;
		expect(created).toHaveLength(0);
		expect(overlaysOf(mesh)).toHaveLength(0);
	});

	it('a mesh removed from the root before resolution is not attached to', async () => {
		const root = new THREE.Group();
		const mesh = meshWithBox();
		root.add(mesh);

		const pending = addEdgesAsync(root);
		mesh.removeFromParent(); // the viewer's clearScene does this on every solve

		const created = await pending;
		expect(created).toHaveLength(0);
		expect(overlaysOf(mesh)).toHaveLength(0);
	});

	it('does not double-attach when applied twice', async () => {
		const root = new THREE.Group();
		const mesh = meshWithBox();
		root.add(mesh);

		const [first, second] = await Promise.all([addEdgesAsync(root), addEdgesAsync(root)]);
		expect(overlaysOf(mesh)).toHaveLength(1);
		expect(first.length + second.length).toBe(1);

		const third = await addEdgesAsync(root);
		expect(third).toHaveLength(0);
		expect(overlaysOf(mesh)).toHaveLength(1);
	});

	it('meshes sharing one geometry get independent line geometries', async () => {
		// Each overlay owns its line geometry since the identity cache was removed (2026-07-30);
		// the extraction behind them is still content-cached. See edges/line-geometry.ts.
		const root = new THREE.Group();
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const meshA = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
		const meshB = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
		root.add(meshA, meshB);

		const created = await addEdgesAsync(root);
		expect(created).toHaveLength(2);
		expect(created[0].geometry).not.toBe(created[1].geometry);
	});
});

describe('caps', () => {
	it('skips meshes over the triangle cap and tags them', () => {
		const root = new THREE.Group();
		const small = meshWithBox();
		const big = new THREE.Mesh(
			new THREE.SphereGeometry(1, 32, 32),
			new THREE.MeshStandardMaterial()
		);
		root.add(small, big);

		const created = addEdges(root, { maxTriangles: 100 });

		expect(created).toHaveLength(1);
		expect(overlaysOf(small)).toHaveLength(1);
		expect(overlaysOf(big)).toHaveLength(0);
		expect(big.userData.edgesSkipped).toBe(EDGES_SKIPPED_TRIANGLE_CAP);
	});

	it('clears the skip tag once a mesh fits under the cap again', () => {
		const root = new THREE.Group();
		const mesh = meshWithBox();
		root.add(mesh);

		addEdges(root, { maxTriangles: 1 });
		expect(mesh.userData.edgesSkipped).toBe(EDGES_SKIPPED_TRIANGLE_CAP);

		addEdges(root);
		expect(mesh.userData.edgesSkipped).toBeUndefined();
		expect(overlaysOf(mesh)).toHaveLength(1);
	});

	it('stops at the overlay budget and tags the rest', () => {
		const root = new THREE.Group();
		const meshes = [meshWithBox(), meshWithBox(), meshWithBox()];
		root.add(...meshes);

		const created = addEdges(root, { maxOverlays: 2 });

		expect(created).toHaveLength(2);
		expect(overlaysOf(meshes[0])).toHaveLength(1);
		expect(overlaysOf(meshes[1])).toHaveLength(1);
		expect(overlaysOf(meshes[2])).toHaveLength(0);
		expect(meshes[2].userData.edgesSkipped).toBe(EDGES_SKIPPED_OVERLAY_BUDGET);
	});

	// The budget is over the whole scene, not per call — otherwise re-applying after each solve
	// would walk the object count up past it a few overlays at a time.
	it('counts overlays from an earlier apply against the budget', () => {
		const root = new THREE.Group();
		const first = meshWithBox();
		root.add(first);
		addEdges(root, { maxOverlays: 2 });

		const second = meshWithBox();
		const third = meshWithBox();
		root.add(second, third);
		const created = addEdges(root, { maxOverlays: 2 });

		expect(created).toHaveLength(1); // one slot left, not two
		expect(overlaysOf(third)).toHaveLength(0);
		expect(third.userData.edgesSkipped).toBe(EDGES_SKIPPED_OVERLAY_BUDGET);
	});

	it('applies the budget on the async path too', async () => {
		const root = new THREE.Group();
		const meshes = [meshWithBox(), meshWithBox(), meshWithBox()];
		root.add(...meshes);

		const created = await addEdgesAsync(root, { maxOverlays: 1 });

		expect(created).toHaveLength(1);
		expect(meshes[2].userData.edgesSkipped).toBe(EDGES_SKIPPED_OVERLAY_BUDGET);
	});

	it('clears the budget skip tag once the mesh fits again', () => {
		const root = new THREE.Group();
		const meshes = [meshWithBox(), meshWithBox()];
		root.add(...meshes);

		addEdges(root, { maxOverlays: 1 });
		expect(meshes[1].userData.edgesSkipped).toBe(EDGES_SKIPPED_OVERLAY_BUDGET);

		removeEdges(root);
		addEdges(root, { maxOverlays: 10 });
		expect(meshes[1].userData.edgesSkipped).toBeUndefined();
		expect(overlaysOf(meshes[1])).toHaveLength(1);
	});

	it('drops the distance fade (stays opaque) above the segment cap', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh, { maxSegments: 2 }); // a box has 12 crease segments

		expect((overlay.material as LineMaterial).transparent).toBe(false);
		// The fade hook installs an own onBeforeRender; a capped overlay keeps the prototype's.
		expect(Object.prototype.hasOwnProperty.call(overlay, 'onBeforeRender')).toBe(false);
	});

	it('keeps the fade under the segment cap', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh);

		expect((overlay.material as LineMaterial).transparent).toBe(true);
		expect(Object.prototype.hasOwnProperty.call(overlay, 'onBeforeRender')).toBe(true);
	});
});
