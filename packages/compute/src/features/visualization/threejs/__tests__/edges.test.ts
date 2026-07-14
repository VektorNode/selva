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

	it('honors a forced color and width on the edge material', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh, { color: '#ff0000', width: 4 });

		const mat = overlay.material as LineSegments2['material'] & { linewidth: number };
		expect(mat.color.getHexString()).toBe('ff0000');
		expect(mat.linewidth).toBe(4);
	});

	it('derives the edge color from the mesh material, darkened toward black', () => {
		const surface = new THREE.MeshStandardMaterial({ color: 0x804020 });
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), surface);
		const [overlay] = addEdges(mesh, { darken: 0.5 });

		// Darkening is a multiplyScalar in Color's linear space (where physical darkening belongs),
		// so compare to that, not naive sRGB-byte halving.
		const expected = surface.color.clone().multiplyScalar(0.5);
		expect((overlay.material as LineMaterial).color.getHexString()).toBe(expected.getHexString());
		// darken=1 collapses to black; darken=0 leaves the surface color untouched.
		expect(
			(
				addEdges(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), surface.clone()), { darken: 1 })[0]
					.material as LineMaterial
			).color.getHexString()
		).toBe('000000');
		expect(
			(
				addEdges(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), surface.clone()), { darken: 0 })[0]
					.material as LineMaterial
			).color.getHexString()
		).toBe(surface.color.getHexString());
	});

	it('meshes of the same surface color share one derived material; different colors do not', () => {
		const root = new THREE.Group();
		const red = () =>
			new THREE.Mesh(
				new THREE.BoxGeometry(1, 1, 1),
				new THREE.MeshStandardMaterial({ color: 0xff0000 })
			);
		const blue = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({ color: 0x0000ff })
		);
		root.add(red(), red(), blue);

		const [a, b, c] = addEdges(root);
		expect(a.material).toBe(b.material); // same surface color → one material
		expect(c.material).not.toBe(a.material); // different color → its own material
	});

	it('falls back to the default edge color when the mesh material has no color', () => {
		// A material lacking a `.color` (e.g. a depth material) can't seed an edge color.
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshDepthMaterial());
		const [overlay] = addEdges(mesh);
		expect((overlay.material as LineMaterial).color.getHexString()).toBe('222222');
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

	it('pushes the mesh surface back instead of pulling edges forward', () => {
		// Regression: edges used to carry a constant multi-ULP bias toward the camera. A depth ULP
		// grows ~quadratically with distance, so zoomed out that bias became a meter-scale pull and
		// hidden edges bled through meshes in front. Edges now render at true depth (no bias) and the
		// surface recedes via slope-scaled polygonOffset instead.
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh);
		const lineMat = overlay.material as LineMaterial;
		const surfaceMat = mesh.material as THREE.Material;

		expect(lineMat.polygonOffset).toBe(false);
		expect(surfaceMat.polygonOffset).toBe(true);
		expect(surfaceMat.polygonOffsetFactor).toBeGreaterThan(0);
		expect(surfaceMat.polygonOffsetUnits).toBeGreaterThan(0);
	});

	it('removeEdges restores the mesh surface depth offset', () => {
		const mesh = meshWithBox();
		addEdges(mesh);
		removeEdges(mesh);

		const surfaceMat = mesh.material as THREE.Material;
		expect(surfaceMat.polygonOffset).toBe(false);
		expect(surfaceMat.polygonOffsetFactor).toBe(0);
		expect(surfaceMat.polygonOffsetUnits).toBe(0);
	});

	it('same-color overlays in one call share a material; separate calls get their own', () => {
		// Both boxes carry a default (white) MeshStandardMaterial, so their derived edge color matches
		// and they collapse onto one material within the call.
		const root = new THREE.Group();
		root.add(meshWithBox(), meshWithBox());
		const [a, b] = addEdges(root);
		expect(a.material).toBe(b.material);

		const [c] = addEdges(meshWithBox());
		expect(c.material).not.toBe(a.material);
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

describe('distance fade', () => {
	// Object3D.onBeforeRender is invoked with (renderer, scene, camera, geometry, material, group);
	// the fade hook reads only renderer (viewport → resolution) and camera.
	function invokeBeforeRender(overlay: LineSegments2, camera: THREE.Camera) {
		const renderer = {
			getViewport: (target: THREE.Vector4) => target.set(0, 0, 800, 600)
		} as unknown as THREE.WebGLRenderer;
		(overlay as THREE.Object3D).onBeforeRender(
			renderer,
			new THREE.Scene(),
			camera,
			overlay.geometry,
			overlay.material,
			{} as THREE.Group
		);
	}

	it('keeps edges opaque up close and fades them out when the mesh is tiny on screen', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh);
		mesh.updateMatrixWorld(true);
		const mat = overlay.material as LineMaterial;
		const camera = new THREE.PerspectiveCamera(20, 800 / 600, 0.01, 2000);

		camera.position.set(0, 0, 3); // unit box fills hundreds of px → fully opaque
		camera.updateMatrixWorld();
		invokeBeforeRender(overlay, camera);
		expect(mat.opacity).toBe(1);

		camera.position.set(0, 0, 800); // a few px on screen → fully faded
		camera.updateMatrixWorld();
		invokeBeforeRender(overlay, camera);
		expect(mat.opacity).toBe(0);
	});

	it('fades under an orthographic camera by frustum coverage', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh);
		mesh.updateMatrixWorld(true);
		const mat = overlay.material as LineMaterial;

		// Frustum 200 world units tall → the unit box covers ~5px of 600 → fully faded.
		const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 100);
		camera.updateMatrixWorld();
		invokeBeforeRender(overlay, camera);
		expect(mat.opacity).toBe(0);
	});

	it('distanceFade: false leaves the material opaque and the render hook untouched', () => {
		const [overlay] = addEdges(meshWithBox(), { distanceFade: false });
		expect((overlay.material as LineMaterial).transparent).toBe(false);
		expect(overlay.onBeforeRender).toBe(LineSegments2.prototype.onBeforeRender);
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
