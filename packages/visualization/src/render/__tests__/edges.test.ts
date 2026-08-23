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

	it('biases the lines toward the camera with no slope term, and never touches the surface', () => {
		// Regression: the surface used to be pushed back with a slope-scaled offset (factor 1). The
		// slope term scales with dZ/dpixel, which is huge on a grazing face, so surfaces receded
		// further than the gaps between stacked parts and geometry behind a wall drew through it.
		// The bias now lives on the lines, units-only, so it is bounded regardless of view angle.
		const mesh = meshWithBox();
		const surfaceBefore = { ...(mesh.material as THREE.Material) };
		const [overlay] = addEdges(mesh);
		const lineMat = overlay.material as LineMaterial;
		const surfaceMat = mesh.material as THREE.Material;

		expect(lineMat.polygonOffset).toBe(true);
		expect(lineMat.polygonOffsetUnits).toBeLessThan(0); // negative = toward the camera
		expect(lineMat.polygonOffsetFactor).toBe(0); // no slope term — the grazing-angle blowout
		expect(surfaceMat.polygonOffsetFactor).toBe(surfaceBefore.polygonOffsetFactor);
		expect(surfaceMat.polygonOffsetUnits).toBe(surfaceBefore.polygonOffsetUnits);
	});

	it('leaves a look preset’s own polygonOffset intact through an add/remove cycle', () => {
		// The old restore path reset surfaces to 0/0 rather than to the preset's values, so toggling
		// edges permanently stripped the offset the material shipped with.
		const mesh = meshWithBox();
		const surfaceMat = mesh.material as THREE.Material;
		surfaceMat.polygonOffset = true;
		surfaceMat.polygonOffsetFactor = 1;
		surfaceMat.polygonOffsetUnits = 1;

		addEdges(mesh);
		removeEdges(mesh);

		expect(surfaceMat.polygonOffset).toBe(true);
		expect(surfaceMat.polygonOffsetFactor).toBe(1);
		expect(surfaceMat.polygonOffsetUnits).toBe(1);
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

	it('keeps edges opaque up close and fades them once they crowd below a pixel apart', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh);
		mesh.updateMatrixWorld(true);
		const mat = overlay.material as LineMaterial;
		const camera = new THREE.PerspectiveCamera(20, 800 / 600, 0.01, 2000);

		camera.position.set(0, 0, 3); // 1-unit edges, hundreds of px apart → fully opaque
		camera.updateMatrixWorld();
		invokeBeforeRender(overlay, camera);
		expect(mat.opacity).toBe(1);

		// Far enough that the box's own 1-unit edge spacing drops under a pixel.
		camera.position.set(0, 0, 5000);
		camera.updateMatrixWorld();
		invokeBeforeRender(overlay, camera);
		expect(mat.opacity).toBe(0);
	});

	it('fades a densely-edged mesh while a sparse one at the same distance stays opaque', () => {
		// The regression this fade exists for: layered sheet goods. Both meshes are the same size on
		// screen, so the old bounding-sphere rule scored them identically and faded neither; only the
		// millimetre-pitch laminations should fade.
		const sparse = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
		const layered = new THREE.Group();
		for (let i = 0; i < 40; i++) {
			const layer = new THREE.Mesh(
				new THREE.BoxGeometry(1, 1, 0.001), // 1mm laminations across a 1-unit part
				new THREE.MeshStandardMaterial()
			);
			layer.position.z = i * 0.001;
			layered.add(layer);
		}

		const [sparseOverlay] = addEdges(sparse);
		const layeredOverlays = addEdges(layered);
		sparse.updateMatrixWorld(true);
		layered.updateMatrixWorld(true);

		const camera = new THREE.PerspectiveCamera(20, 800 / 600, 0.01, 2000);
		camera.position.set(0, 0, 20);
		camera.updateMatrixWorld();

		invokeBeforeRender(sparseOverlay, camera);
		expect((sparseOverlay.material as LineMaterial).opacity).toBe(1);

		invokeBeforeRender(layeredOverlays[0], camera);
		expect((layeredOverlays[0].material as LineMaterial).opacity).toBe(0);
	});

	it('fades under an orthographic camera by edge density', () => {
		const mesh = meshWithBox();
		const [overlay] = addEdges(mesh);
		mesh.updateMatrixWorld(true);
		const mat = overlay.material as LineMaterial;

		// Frustum 2000 units tall → the box's 1-unit edges land ~0.3px apart → fully faded.
		const camera = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 5000);
		camera.updateMatrixWorld();
		invokeBeforeRender(overlay, camera);
		expect(mat.opacity).toBe(0);

		// A tight frustum resolves them again.
		const close = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
		close.updateMatrixWorld();
		invokeBeforeRender(overlay, close);
		expect(mat.opacity).toBe(1);
	});

	it('distanceFade: false leaves the material opaque and the render hook untouched', () => {
		const [overlay] = addEdges(meshWithBox(), { distanceFade: false });
		expect((overlay.material as LineMaterial).transparent).toBe(false);
		expect(overlay.onBeforeRender).toBe(LineSegments2.prototype.onBeforeRender);
	});
});

describe('edge geometry ownership', () => {
	function meshSharing(geometry: THREE.BufferGeometry): THREE.Mesh {
		return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
	}

	// The identity-keyed cache that made overlays SHARE one LineSegmentsGeometry was removed on
	// 2026-07-30 (see edges/line-geometry.ts). Sharing is what forced the refcount protocol and
	// what leaked in F1; each overlay now owns its geometry. Extraction is still cached by
	// content, so the work these tests once guarded against is still not repeated — see
	// 'reuses extracted segments across meshes with identical content' below.

	it('meshes sharing one source geometry get independent line geometries', () => {
		const shared = new THREE.BoxGeometry(1, 1, 1);
		const root = new THREE.Group();
		root.add(meshSharing(shared), meshSharing(shared));

		const [a, b] = addEdges(root);

		expect(a.geometry).not.toBe(b.geometry);
	});

	it('meshes with different source geometries do not share edge geometry', () => {
		const [a] = addEdges(meshWithBox());
		const [b] = addEdges(meshWithBox());

		expect(a.geometry).not.toBe(b.geometry);
	});

	it('distinct crease angles on the same source produce distinct segment sets', () => {
		// The crease angle is part of the extraction cache key, so changing it must re-extract
		// rather than serve the previous angle's segments.
		const shared = new THREE.BoxGeometry(1, 1, 1);
		const [a] = addEdges(meshSharing(shared), { thresholdAngle: 30 });
		const [b] = addEdges(meshSharing(shared), { thresholdAngle: 60 });

		expect(a.geometry).not.toBe(b.geometry);
	});

	it('removeEdges disposes each overlay geometry independently', () => {
		const shared = new THREE.BoxGeometry(1, 1, 1);
		const first = meshSharing(shared);
		const second = meshSharing(shared);
		const root = new THREE.Group();
		root.add(first, second);

		const [a, b] = addEdges(root);
		const disposeA = vi.spyOn(a.geometry, 'dispose');
		const disposeB = vi.spyOn(b.geometry, 'dispose');

		removeEdges(first);
		expect(disposeA).toHaveBeenCalledTimes(1);
		expect(disposeB).not.toHaveBeenCalled(); // second overlay untouched

		removeEdges(second);
		expect(disposeB).toHaveBeenCalledTimes(1);
	});
});
