import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCameraController } from '../camera-controller';

// The controller only reads `target`, `object`, `enableRotate`, and calls `update()` on controls —
// not the full OrbitControls (which needs a DOM). A minimal stub keeps the test environment 'node'.
function stubControls(camera: THREE.Camera) {
	return {
		target: new THREE.Vector3(0, 0, 0),
		object: camera as THREE.Camera,
		enableRotate: true,
		update: () => {}
	} as unknown as OrbitControls;
}

function makeController(up: THREE.Vector3) {
	const scene = new THREE.Scene();
	// One unit box at the origin so setView has content to frame.
	scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));

	const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 2000);
	camera.up.copy(up);
	const controls = stubControls(camera);

	const controller = createCameraController({
		scene,
		perspective: camera,
		controls,
		onActiveCameraChange: () => {},
		up
	});
	return { scene, camera, controls, controller };
}

/** Half-height of the perspective view at the target plane, for a given camera distance. */
const halfHeightAt = (fovDegrees: number, distance: number) =>
	distance * Math.tan((fovDegrees * Math.PI) / 360);

/** The controller's fit distance for content of size maxDim (mirrors its framing formula). */
const fitDistance = (fovDegrees: number, maxDim: number) =>
	(maxDim / (2 * Math.tan((fovDegrees * Math.PI) / 360))) * 1.5;

describe('camera-controller presets are up-aware', () => {
	it('Z-up: "top" places the camera along +Z above the target', () => {
		const up = new THREE.Vector3(0, 0, 1);
		const { camera, controls, controller } = makeController(up);

		controller.setView('top', false); // no animation: position is final immediately

		const dir = camera.position.clone().sub(controls.target).normalize();
		// Camera looks DOWN the up axis, so it sits on the +up side of the target.
		expect(dir.dot(up)).toBeGreaterThan(0.99);
	});

	it('Y-up: "top" places the camera along +Y above the target', () => {
		const up = new THREE.Vector3(0, 1, 0);
		const { camera, controls, controller } = makeController(up);

		controller.setView('top', false);

		const dir = camera.position.clone().sub(controls.target).normalize();
		expect(dir.dot(up)).toBeGreaterThan(0.99);
	});

	it('Z-up: "front" is orthogonal to up (a side view, not a top-down)', () => {
		const up = new THREE.Vector3(0, 0, 1);
		const { camera, controls, controller } = makeController(up);

		controller.setView('front', false);

		const dir = camera.position.clone().sub(controls.target).normalize();
		// Front faces across the ground plane: no up-component.
		expect(Math.abs(dir.dot(up))).toBeLessThan(0.01);
	});

	it('toggleProjection swaps perspective ⇄ orthographic and preserves the up axis', () => {
		const up = new THREE.Vector3(0, 0, 1);
		const { controller } = makeController(up);

		expect(controller.getProjection()).toBe('perspective');
		expect(controller.toggleProjection()).toBe('orthographic');
		const ortho = controller.getActiveCamera();
		expect(ortho).toBeInstanceOf(THREE.OrthographicCamera);
		expect(ortho.up.clone().normalize().dot(up)).toBeGreaterThan(0.99);
	});
});

describe('ortho/perspective round-trips (issues 10/11)', () => {
	const up = new THREE.Vector3(0, 0, 1);

	it('carries 2D dolly (ortho.zoom) back as perspective distance on the 3D switch', () => {
		const { camera, controls, controller } = makeController(up);
		controller.setView('front', false);
		const distanceBefore = camera.position.distanceTo(controls.target);

		controller.setProjection('orthographic');
		const ortho = controller.getActiveCamera() as THREE.OrthographicCamera;
		// OrbitControls dollies an ortho camera via `zoom`, not position — simulate a 2x zoom-in.
		ortho.zoom = 2;

		controller.setProjection('perspective');
		const distanceAfter = camera.position.distanceTo(controls.target);
		// The perspective view's apparent size must match the zoomed ortho view: half the distance.
		expect(distanceAfter).toBeCloseTo(distanceBefore / 2, 6);
		// And the apparent half-heights agree exactly.
		expect(halfHeightAt(camera.fov, distanceAfter)).toBeCloseTo(ortho.top / ortho.zoom, 6);
	});

	it('resets ortho.zoom to 1 when re-entering 2D so the frustum is not double-scaled', () => {
		const { controller } = makeController(up);
		controller.setView('front', false);

		controller.setProjection('orthographic');
		const ortho = controller.getActiveCamera() as THREE.OrthographicCamera;
		ortho.zoom = 3;
		controller.setProjection('perspective');
		controller.setProjection('orthographic');

		expect(ortho.zoom).toBe(1);
	});

	it('2D→3D→2D round-trip preserves the apparent view size (no zoom jump)', () => {
		const { camera, controls, controller } = makeController(up);
		controller.setView('front', false);

		controller.setProjection('orthographic');
		const ortho = controller.getActiveCamera() as THREE.OrthographicCamera;
		ortho.zoom = 2.5;
		const visibleHalfH = ortho.top / ortho.zoom;

		controller.setProjection('perspective');
		controller.setProjection('orthographic');

		// Frustum re-derived from the carried-over distance, zoom reset — same visible extent.
		expect(ortho.top / ortho.zoom).toBeCloseTo(visibleHalfH, 6);
		expect(halfHeightAt(camera.fov, camera.position.distanceTo(controls.target))).toBeCloseTo(
			visibleHalfH,
			6
		);
	});

	it('sizes the ortho frustum from the ACTIVE camera, not the stale perspective one (issue 11)', () => {
		const { scene, camera, controls, controller } = makeController(up);
		controller.setView('front', false);
		const staleDistance = camera.position.distanceTo(controls.target);

		controller.setProjection('orthographic');
		const ortho = controller.getActiveCamera() as THREE.OrthographicCamera;

		// Content grows while in 2D mode; a preset view must now fit the LARGER content. The old code
		// sized the frustum from the perspective camera's stale distance instead.
		scene.add(new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshStandardMaterial()));
		controller.setView('top', false);

		const expected = halfHeightAt(camera.fov, fitDistance(camera.fov, 5));
		expect(ortho.top).toBeCloseTo(expected, 6);
		expect(ortho.top).not.toBeCloseTo(halfHeightAt(camera.fov, staleDistance), 2);
	});

	it('resize in 2D mode keeps the frustum height derived from the ortho camera distance', () => {
		const { camera, controls, controller } = makeController(up);
		controller.setView('front', false);
		controller.setProjection('orthographic');
		const ortho = controller.getActiveCamera() as THREE.OrthographicCamera;
		const topBefore = ortho.top;

		controller.updateAspect(200, 100);

		// Height unchanged (same distance), width follows the new aspect.
		expect(ortho.top).toBeCloseTo(topBefore, 6);
		expect(ortho.right).toBeCloseTo(topBefore * 2, 6);
		expect(halfHeightAt(camera.fov, ortho.position.distanceTo(controls.target))).toBeCloseTo(
			ortho.top,
			6
		);
	});
});

describe('frameBounds (issue 9 support)', () => {
	const up = new THREE.Vector3(0, 0, 1);

	it('perspective: moves the camera to the fit distance along the current view direction', () => {
		const { camera, controls, controller } = makeController(up);
		controller.setView('front', false);
		const directionBefore = camera.position.clone().sub(controls.target).normalize();

		const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2));
		controller.frameBounds(box, false);

		const center = new THREE.Vector3(1, 1, 1);
		expect(controls.target.distanceTo(center)).toBeLessThan(1e-9);
		expect(camera.position.distanceTo(center)).toBeCloseTo(fitDistance(camera.fov, 2), 6);
		const directionAfter = camera.position.clone().sub(controls.target).normalize();
		expect(directionAfter.dot(directionBefore)).toBeGreaterThan(0.999);
	});

	it('orthographic: moves the ORTHO camera and resizes its frustum to fit the box', () => {
		const { camera, controls, controller } = makeController(up);
		controller.setView('front', false);
		controller.setProjection('orthographic');
		const ortho = controller.getActiveCamera() as THREE.OrthographicCamera;
		ortho.zoom = 4; // stale user zoom must not defeat the fit
		const perspectiveBefore = camera.position.clone();

		const box = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2));
		controller.frameBounds(box, false);

		expect(ortho.zoom).toBe(1);
		expect(ortho.top).toBeCloseTo(halfHeightAt(camera.fov, fitDistance(camera.fov, 4)), 6);
		expect(controls.target.length()).toBeLessThan(1e-9);
		expect(ortho.position.distanceTo(controls.target)).toBeCloseTo(fitDistance(camera.fov, 4), 6);
		// The perspective camera is NOT the one that moved.
		expect(camera.position.distanceTo(perspectiveBefore)).toBeLessThan(1e-9);
	});

	it('ignores an empty box', () => {
		const { camera, controller } = makeController(up);
		controller.setView('front', false);
		const before = camera.position.clone();

		controller.frameBounds(new THREE.Box3(), false);

		expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);
	});
});

describe('camera tween lifecycle (issue 24)', () => {
	const up = new THREE.Vector3(0, 0, 1);
	let pending: Map<number, FrameRequestCallback>;
	let nextId: number;
	let now: number;

	const flushFrames = () => {
		const callbacks = [...pending.values()];
		pending.clear();
		callbacks.forEach((cb) => cb(now));
	};

	beforeEach(() => {
		pending = new Map();
		nextId = 1;
		now = 0;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			const id = nextId++;
			pending.set(id, cb);
			return id;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			pending.delete(id);
		});
		vi.spyOn(performance, 'now').mockImplementation(() => now);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('starting a new tween cancels the previous one (no competing loops)', () => {
		const { camera, controller } = makeController(up);

		controller.setView('top', true);
		expect(pending.size).toBe(1);

		controller.setView('front', true);
		// The first tween's pending frame was cancelled — exactly one loop remains.
		expect(pending.size).toBe(1);

		// Run the surviving tween to completion: only 'front' drives the camera.
		now = 1000;
		flushFrames();
		expect(pending.size).toBe(0);
		const dir = camera.position.clone().normalize();
		expect(Math.abs(dir.dot(up))).toBeLessThan(0.02); // front = in-plane, not top-down
	});

	it('dispose() stops an in-flight tween so no tick touches disposed controls', () => {
		const { camera, controls, controller } = makeController(up);
		const updateSpy = vi.spyOn(controls, 'update');

		controller.setView('top', true);
		const positionAtDispose = camera.position.clone();
		updateSpy.mockClear();

		controller.dispose();
		expect(pending.size).toBe(0);

		now = 1000;
		flushFrames();
		expect(updateSpy).not.toHaveBeenCalled();
		expect(camera.position.distanceTo(positionAtDispose)).toBeLessThan(1e-9);
	});

	it('setProjection cancels an in-flight tween (it would keep lerping the old camera)', () => {
		const { controller } = makeController(up);

		controller.setView('top', true);
		expect(pending.size).toBe(1);

		controller.setProjection('orthographic');
		expect(pending.size).toBe(0);
	});
});
