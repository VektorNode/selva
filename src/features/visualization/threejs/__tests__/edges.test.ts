import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { describe, expect, it, vi } from 'vitest';

import { addEdges, removeEdges, isEdgeOverlay, EDGE_USERDATA_KIND } from '../edges';

function meshWithBox(): THREE.Mesh {
	return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
}

describe('addEdges', () => {
	it('attaches one edge overlay as a child of each mesh', () => {
		const root = new THREE.Group();
		const mesh = meshWithBox();
		root.add(mesh);

		const created = addEdges(root);

		expect(created).toHaveLength(1);
		expect(created[0]).toBeInstanceOf(LineSegments2);
		// Overlay is parented to the mesh so it inherits transform and disposes with it.
		expect(mesh.children).toContain(created[0]);
		expect(created[0].userData.kind).toBe(EDGE_USERDATA_KIND);
	});

	it('honors color and width on the edge material', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh, { color: '#ff0000', width: 4 });

		const mat = overlay.material as LineSegments2['material'] & { linewidth: number };
		expect(mat.color.getHexString()).toBe('ff0000');
		expect(mat.linewidth).toBe(4);
	});

	it('skips the floor, the grid, and existing overlays', () => {
		const root = new THREE.Group();
		const floor = meshWithBox();
		floor.userData.id = 'floor';
		const grid = meshWithBox();
		grid.userData.id = 'grid';
		root.add(floor, grid);

		expect(addEdges(root)).toHaveLength(0);
	});

	it('is idempotent — a second call adds no duplicate overlays', () => {
		const mesh = meshWithBox();
		expect(addEdges(mesh)).toHaveLength(1);
		expect(addEdges(mesh)).toHaveLength(0);
		expect(mesh.children.filter((c) => isEdgeOverlay(c))).toHaveLength(1);
	});

	it('edge overlays are not raycast-pickable', () => {
		const [overlay] = addEdges(meshWithBox());
		const raycaster = new THREE.Raycaster();
		const hits: THREE.Intersection[] = [];
		overlay.raycast(raycaster, hits);
		expect(hits).toHaveLength(0);
	});

	it('applies a multi-ULP constant depth offset toward the camera', () => {
		// The fat-line quads face the screen (depth slope ≈ 0), so the slope-scaled factor term is
		// nil — the constant units term must exceed one depth ULP or edges stipple at glancing
		// angles / far zoom on 24-bit depth buffers.
		const [overlay] = addEdges(meshWithBox());
		const mat = overlay.material as LineMaterial;

		expect(mat.polygonOffset).toBe(true);
		expect(mat.polygonOffsetFactor).toBe(-1);
		expect(mat.polygonOffsetUnits).toBeLessThanOrEqual(-2);
	});

	it('removeEdges strips every overlay and reports the count', () => {
		const root = new THREE.Group();
		root.add(meshWithBox(), meshWithBox());
		addEdges(root);
		expect(root.children.flatMap((m) => m.children).filter(isEdgeOverlay)).toHaveLength(2);

		const removed = removeEdges(root);
		expect(removed).toBe(2);
		expect(root.children.flatMap((m) => m.children).filter(isEdgeOverlay)).toHaveLength(0);
		// And re-adding works (idempotency holds after removal).
		expect(addEdges(root)).toHaveLength(2);
	});
});

describe('edge geometry cache', () => {
	function meshSharing(geometry: THREE.BufferGeometry): THREE.Mesh {
		return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
	}

	it('meshes sharing one source geometry share one extracted edge geometry', () => {
		// Regression: the extraction used to run per mesh, recomputing and re-uploading N identical
		// buffers for N instances of the same part.
		const shared = new THREE.BoxGeometry(1, 1, 1);
		const root = new THREE.Group();
		root.add(meshSharing(shared), meshSharing(shared));

		const [a, b] = addEdges(root);

		expect(a.geometry).toBe(b.geometry);
	});

	it('distinct crease angles on the same source get distinct edge geometries', () => {
		const shared = new THREE.BoxGeometry(1, 1, 1);
		const [a] = addEdges(meshSharing(shared), { thresholdAngle: 30 });
		const [b] = addEdges(meshSharing(shared), { thresholdAngle: 60 });

		expect(a.geometry).not.toBe(b.geometry);
	});

	it('meshes with different source geometries do not share edge geometry', () => {
		const [a] = addEdges(meshWithBox());
		const [b] = addEdges(meshWithBox());

		expect(a.geometry).not.toBe(b.geometry);
	});

	it('removeEdges disposes a shared edge geometry only with its last overlay', () => {
		const shared = new THREE.BoxGeometry(1, 1, 1);
		const first = meshSharing(shared);
		const second = meshSharing(shared);
		const root = new THREE.Group();
		root.add(first, second);

		const [a] = addEdges(root);
		const disposeSpy = vi.spyOn(a.geometry, 'dispose');

		removeEdges(first);
		expect(disposeSpy).not.toHaveBeenCalled(); // second still renders it

		removeEdges(second);
		expect(disposeSpy).toHaveBeenCalledTimes(1);

		// A fresh addEdges re-extracts instead of resurrecting the disposed cache entry.
		const [again] = addEdges(first);
		expect(again.geometry).not.toBe(a.geometry);
	});
});
