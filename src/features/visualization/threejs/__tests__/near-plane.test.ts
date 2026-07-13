import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

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
		const camera = cameraAt(0.88); // gap ≈ 0.01 → dynamic value below the 0.01 floor
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
			groundNormals: [new THREE.Vector3(0, 0, 1)]
		});

		fitter.update();

		expect(camera.near).toBeCloseTo(1);
	});

	it('leaves near untouched when the scene has no content', () => {
		const camera = cameraAt(500);
		const fitter = createNearPlaneFitter({ camera, scene: new THREE.Scene() });

		fitter.update();

		expect(camera.near).toBe(0.01);
	});
});
