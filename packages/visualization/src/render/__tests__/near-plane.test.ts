import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { EDGE_USERDATA_KIND } from '../edges/options';
import { createNearPlaneFitter } from '../near-plane';

function sceneWithUnitBoxAt(x = 0, y = 0, z = 0): THREE.Scene {
	const scene = new THREE.Scene();
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
	mesh.position.set(x, y, z);
	scene.add(mesh);
	return scene;
}

function cameraAt(z: number): THREE.PerspectiveCamera {
	const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 2000);
	camera.position.set(0, 0, z);
	return camera;
}

describe('createNearPlaneFitter', () => {
	it('raises near toward half the camera↔content gap when zoomed out', () => {
		const camera = cameraAt(30); // gap ≈ 30 − r(≈0.87) ≈ 29.1
		const fitter = createNearPlaneFitter({ camera, scene: sceneWithUnitBoxAt() });

		fitter.update();

		expect(camera.near).toBeGreaterThan(10);
		expect(camera.near).toBeLessThan(15);
	});

	it('caps near at a fraction of far so the frustum stays sane', () => {
		const camera = cameraAt(10_000);
		const fitter = createNearPlaneFitter({ camera, scene: sceneWithUnitBoxAt() });

		fitter.update();

		expect(camera.near).toBe(camera.far * 0.01);
	});

	it('never lowers near below the configured floor up close', () => {
		const camera = cameraAt(0.51); // box face 0.01 ahead → dynamic value below the 0.01 floor
		const fitter = createNearPlaneFitter({ camera, scene: sceneWithUnitBoxAt() });

		fitter.update();

		expect(camera.near).toBe(0.01);
	});

	it('adopts an external near write (per-solve static fit) as the new floor', () => {
		const camera = cameraAt(0.88);
		const fitter = createNearPlaneFitter({ camera, scene: sceneWithUnitBoxAt() });

		camera.near = 5; // e.g. updateScene's huge-scene fit
		fitter.update();

		expect(camera.near).toBe(5);
	});

	it('caps near at half the camera height above a ground plane', () => {
		// Content far off to the side, camera hovering 2 above the Z ground plane: the content gap
		// alone would allow near ≈ 100, but the grid/floor under the camera must not clip.
		const scene = sceneWithUnitBoxAt(200, 0, 0);
		const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 2000);
		camera.position.set(0, 0, 2);
		const fitter = createNearPlaneFitter({
			camera,
			scene,
			groundNormals: () => [new THREE.Vector3(0, 0, 1)]
		});

		fitter.update();

		expect(camera.near).toBeCloseTo(1);
	});

	it('ignores a ground plane whose aid is currently hidden', () => {
		// Same geometry as above, but the aid is toggled off — a hidden grid must not clamp near to
		// the camera's height, which would crater depth precision (ULP ∝ 1/near) at grazing views.
		const scene = sceneWithUnitBoxAt(200, 0, 0);
		const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 2000);
		camera.position.set(0, 0, 2);
		let gridVisible = false;
		const fitter = createNearPlaneFitter({
			camera,
			scene,
			groundNormals: () => (gridVisible ? [new THREE.Vector3(0, 0, 1)] : [])
		});

		fitter.update();
		// Free of the hidden aid's clamp, near rises to the MAX_NEAR_TO_FAR ceiling (far * 0.01) —
		// 20× the 1 it would have been pinned to, i.e. 20× the depth precision.
		expect(camera.near).toBeCloseTo(20);

		// Toggling the aid on re-applies the clamp on the next frame, with no re-init.
		gridVisible = true;
		fitter.update();
		expect(camera.near).toBeCloseTo(1);
	});

	it('fits to the nearest geometry in view, not the whole scene sphere', () => {
		// A merged mesh of three spheres. The camera sits inside its bounding sphere, which used to
		// pin near to the floor, but the nearest thing in view is 4 ahead.
		const near = new THREE.SphereGeometry(1, 32, 32);
		const behind = new THREE.SphereGeometry(1, 32, 32).translate(0, 0, 10);
		const ahead = new THREE.SphereGeometry(1, 32, 32).translate(0, 0, -50);
		const scene = new THREE.Scene();
		const merged = new THREE.Mesh(
			mergeGeometries([near, behind, ahead]),
			new THREE.MeshBasicMaterial()
		);
		// Member windows keep chunks from boxing the gap between two spheres.
		const sphereIndexCount = near.getIndex()!.count;
		merged.userData.members = [0, 1, 2].map((i) => ({
			name: String(i),
			layer: '',
			metadata: {},
			indexStart: i * sphereIndexCount,
			indexCount: sphereIndexCount
		}));
		scene.add(merged);
		const camera = cameraAt(-45); // looks down -Z: 'ahead' is 4 away, the rest behind

		createNearPlaneFitter({ camera, scene }).update();

		expect(camera.near).toBeGreaterThan(1.5);
		expect(camera.near).toBeLessThanOrEqual(2);
	});

	it('measures a Line2 curve by its points, not its template quad', () => {
		// A curve 4 ahead of the camera, its object origin far behind it.
		const geometry = new LineGeometry();
		geometry.setPositions([-1, 0, -50, 1, 0, -50]);
		const scene = new THREE.Scene();
		scene.add(new Line2(geometry, new LineMaterial()));
		const camera = cameraAt(-46);

		createNearPlaneFitter({ camera, scene }).update();

		expect(camera.near).toBeGreaterThan(1.5);
		expect(camera.near).toBeLessThanOrEqual(2);
	});

	it('keeps a face in view whose corners are all off-screen', () => {
		// Two triangles, every vertex far outside the frustum, the face itself 2 ahead.
		const scene = new THREE.Scene();
		scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial()));
		const camera = cameraAt(2);

		createNearPlaneFitter({ camera, scene }).update();

		expect(camera.near).toBeLessThanOrEqual(1);
	});

	it('measures triangles, not the box, when a chunk reaches behind the camera', () => {
		// One chunk: a face 10 ahead, and one off to the side and behind. Their joint box contains
		// the camera, which on its own would pin near to the floor.
		const ahead = new THREE.PlaneGeometry(2, 2).translate(0, 0, -10);
		const behind = new THREE.PlaneGeometry(10, 10).rotateY(Math.PI / 2).translate(50, 0, 10);
		const scene = new THREE.Scene();
		scene.add(new THREE.Mesh(mergeGeometries([ahead, behind]), new THREE.MeshBasicMaterial()));
		const camera = cameraAt(0);

		createNearPlaneFitter({ camera, scene }).update();

		expect(camera.near).toBeCloseTo(5);
	});

	it('ignores hidden content and edge overlays', () => {
		const scene = sceneWithUnitBoxAt(0, 0, -20);
		const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
		hidden.position.set(0, 0, 5);
		hidden.visible = false;
		scene.add(hidden);
		const overlay = new THREE.Mesh(
			new THREE.BoxGeometry(100, 100, 100),
			new THREE.MeshBasicMaterial()
		);
		overlay.userData.kind = EDGE_USERDATA_KIND;
		scene.children[0]!.add(overlay);
		const camera = cameraAt(10);

		createNearPlaneFitter({ camera, scene }).update();

		expect(camera.near).toBeCloseTo(14.75); // half the 29.5 to the visible box's face
	});

	it('leaves near untouched when the scene has no content', () => {
		const camera = cameraAt(500);
		const fitter = createNearPlaneFitter({ camera, scene: new THREE.Scene() });

		fitter.update();

		expect(camera.near).toBe(0.01);
	});
});
