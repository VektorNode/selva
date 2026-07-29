import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { describe, expect, it, vi } from 'vitest';

import { EDGES_SKIPPED_TRIANGLE_CAP, addEdges, addEdgesAsync, removeEdges } from '../edges';

// Spy on the extractor to observe cache hits/misses; behavior stays the real implementation.
vi.mock('../edge-extract', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../edge-extract')>();
	return { ...actual, extractEdgeSegments: vi.fn(actual.extractEdgeSegments) };
});

import { extractEdgeSegments } from '../edge-extract';

const extractSpy = vi.mocked(extractEdgeSegments);

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

	it('meshes sharing one geometry share one line geometry', async () => {
		const root = new THREE.Group();
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const meshA = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
		const meshB = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
		root.add(meshA, meshB);

		const created = await addEdgesAsync(root);
		expect(created).toHaveLength(2);
		expect(created[0].geometry).toBe(created[1].geometry);
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

describe('cross-solve content cache', () => {
	it('re-solving with identical content skips extraction entirely', () => {
		// Distinctive size so this content key is unique to this test.
		const SIZE = 3.7317;

		const firstSolve = meshWithBox(SIZE);
		addEdges(firstSolve);
		const callsAfterFirst = extractSpy.mock.calls.length;
		removeEdges(firstSolve); // viewer clears content between solves

		// A NEW geometry object with the same content — what every re-solve produces.
		const secondSolve = meshWithBox(SIZE);
		const created = addEdges(secondSolve);

		expect(created).toHaveLength(1);
		expect(extractSpy.mock.calls.length).toBe(callsAfterFirst); // no new extraction
	});

	it('changed content misses the cache and re-extracts', () => {
		const firstSolve = meshWithBox(5.111);
		addEdges(firstSolve);
		const callsAfterFirst = extractSpy.mock.calls.length;

		const changed = meshWithBox(5.222);
		addEdges(changed);
		expect(extractSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
	});
});
