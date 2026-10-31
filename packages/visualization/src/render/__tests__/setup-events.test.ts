import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { setupEventHandlers } from '../scene-setup/setup-events';

import type { CameraController } from '../camera-controller';
import type { ResolvedOptions } from '../scene-setup/defaults';

const CANVAS_SIZE = { width: 800, height: 600 };
/** Centre of the canvas, where the cube is. */
const CENTRE = { clientX: CANVAS_SIZE.width / 2, clientY: CANVAS_SIZE.height / 2 };

/**
 * The suite runs under `environment: 'node'` (see tests/setup.ts), so there is no DOM. The handlers
 * only ever add/remove listeners, dispatch to them, and call `getBoundingClientRect` — this covers
 * exactly that, which is cheaper than pulling jsdom in for one file.
 */
function fakeCanvas() {
	const listeners = new Map<string, ((event: unknown) => void)[]>();
	const canvas = {
		addEventListener: (type: string, fn: (event: unknown) => void) => {
			listeners.set(type, [...(listeners.get(type) ?? []), fn]);
		},
		removeEventListener: (type: string, fn: (event: unknown) => void) => {
			listeners.set(
				type,
				(listeners.get(type) ?? []).filter((l) => l !== fn)
			);
		},
		setAttribute: () => {},
		getBoundingClientRect: () => ({ left: 0, top: 0, ...CANVAS_SIZE })
	};
	const fire = (type: string, event: Record<string, unknown>) => {
		for (const fn of listeners.get(type) ?? []) fn(event);
	};
	return { canvas: canvas as unknown as HTMLCanvasElement, fire };
}

function sceneWithCube(): THREE.Scene {
	const scene = new THREE.Scene();
	const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
	cube.userData = { name: 'cube', layer: 'Default' };
	cube.updateMatrixWorld(true);
	scene.add(cube);
	return scene;
}

function stubCameraController(): CameraController {
	const camera = new THREE.PerspectiveCamera(50, CANVAS_SIZE.width / CANVAS_SIZE.height, 0.1, 1000);
	camera.position.set(0, 0, 10);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld(true);
	return {
		getActiveCamera: () => camera,
		frameBounds: vi.fn()
	} as unknown as CameraController;
}

describe('setupEventHandlers click vs double-click', () => {
	function setup() {
		const { canvas, fire } = fakeCanvas();
		const onMeshMetadataClicked = vi.fn();
		const onMeshDoubleClicked = vi.fn();
		const config = {
			events: {
				enableClickToFocus: true,
				enableDoubleClickZoom: true,
				enableKeyboardControls: false,
				selectionColor: '#ff0000',
				onMeshMetadataClicked,
				onMeshDoubleClicked
			}
		} as unknown as ResolvedOptions;

		const handlers = setupEventHandlers(canvas, sceneWithCube(), stubCameraController(), config);
		const click = () => {
			fire('mousedown', CENTRE);
			fire('click', CENTRE);
		};
		return { click, fire, handlers, onMeshMetadataClicked, onMeshDoubleClicked };
	}

	it('selects and opens the metadata panel synchronously on a single click', () => {
		const { click, handlers, onMeshMetadataClicked } = setup();

		click();

		// No timers advanced: selection must not wait out a double-click window.
		expect(onMeshMetadataClicked).toHaveBeenCalledTimes(1);
		handlers.dispose();
	});

	it('reports the double-click without re-reporting the already-selected object', () => {
		const { click, fire, handlers, onMeshMetadataClicked, onMeshDoubleClicked } = setup();

		click();
		click();
		fire('dblclick', CENTRE);

		expect(onMeshDoubleClicked).toHaveBeenCalledTimes(1);
		// The second press lands on the object the first already selected.
		expect(onMeshMetadataClicked).toHaveBeenCalledTimes(1);
		handlers.dispose();
	});

	it('frames all content on a double-click over empty background', () => {
		const { canvas, fire } = fakeCanvas();
		const controller = stubCameraController();
		const config = {
			events: { enableClickToFocus: true, enableDoubleClickZoom: true, selectionColor: '#ff0000' }
		} as unknown as ResolvedOptions;
		const handlers = setupEventHandlers(canvas, sceneWithCube(), controller, config);

		fire('dblclick', { clientX: 5, clientY: 5 });

		const [box, animate] = vi.mocked(controller.frameBounds).mock.calls[0];
		expect(box.getSize(new THREE.Vector3()).x).toBe(2);
		expect(animate).toBe(true);
		handlers.dispose();
	});

	it('ignores a click that was really a drag', () => {
		const { fire, handlers, onMeshMetadataClicked } = setup();

		fire('mousedown', CENTRE);
		fire('click', { clientX: CENTRE.clientX + 40, clientY: CENTRE.clientY });

		expect(onMeshMetadataClicked).not.toHaveBeenCalled();
		handlers.dispose();
	});
});

describe('setupEventHandlers hover tint', () => {
	const config = {
		events: { enableClickToFocus: true, selectionColor: '#ff0000' }
	} as unknown as ResolvedOptions;

	it('tints the hovered object and restores its own material when hover moves on', () => {
		const { canvas } = fakeCanvas();
		const scene = sceneWithCube();
		const other = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
		scene.add(other);
		const cube = scene.children[0] as THREE.Mesh;
		const original = cube.material;
		const handlers = setupEventHandlers(canvas, scene, stubCameraController(), config);

		handlers.setHoverTint(cube);
		expect(cube.material).not.toBe(original);

		handlers.setHoverTint(other);
		expect(cube.material).toBe(original);

		handlers.setHoverTint(null);
		handlers.dispose();
	});

	it('leaves the selected object alone', () => {
		const { canvas, fire } = fakeCanvas();
		const scene = sceneWithCube();
		const cube = scene.children[0] as THREE.Mesh;
		const handlers = setupEventHandlers(canvas, scene, stubCameraController(), config);

		fire('mousedown', CENTRE);
		fire('click', CENTRE);
		const selected = cube.material;
		handlers.setHoverTint(cube);

		expect(cube.material).toBe(selected);
		handlers.dispose();
	});
});

describe('setupEventHandlers selectEntries', () => {
	const config = {
		events: { enableClickToFocus: true, selectionColor: '#ff0000' }
	} as unknown as ResolvedOptions;

	function mergedMesh() {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
		mesh.userData.members = [
			{ name: 'a', layer: '', metadata: {}, indexStart: 0, indexCount: 12 },
			{ name: 'b', layer: '', metadata: {}, indexStart: 12, indexCount: 12 },
			{ name: 'c', layer: '', metadata: {}, indexStart: 24, indexCount: 12 }
		];
		return mesh;
	}

	it('tints every target and restores them when replaced', () => {
		const { canvas } = fakeCanvas();
		const scene = sceneWithCube();
		const cube = scene.children[0] as THREE.Mesh;
		const merged = mergedMesh();
		scene.add(merged);
		const cubeMaterial = cube.material;
		const mergedMaterial = merged.material;
		const handlers = setupEventHandlers(canvas, scene, stubCameraController(), config);

		handlers.selectEntries([
			{ object: cube, memberIndex: null },
			{ object: merged, memberIndex: 0 },
			{ object: merged, memberIndex: 2 }
		]);

		expect(cube.material).not.toBe(cubeMaterial);
		expect(merged.material).toHaveLength(2);
		expect(merged.geometry.groups.filter((g) => g.materialIndex === 1)).toHaveLength(2);

		handlers.selectEntries([]);

		expect(cube.material).toBe(cubeMaterial);
		expect(merged.material).toBe(mergedMaterial);
		handlers.dispose();
	});

	it('leaves a canvas selection alone when told there is nothing to select', () => {
		const { canvas, fire } = fakeCanvas();
		const scene = sceneWithCube();
		const cube = scene.children[0] as THREE.Mesh;
		const handlers = setupEventHandlers(canvas, scene, stubCameraController(), config);

		fire('mousedown', CENTRE);
		fire('click', CENTRE);
		const selected = cube.material;
		handlers.selectEntries([]);

		expect(cube.material).toBe(selected);
		handlers.dispose();
	});

	it('treats a click on an entry-selected object as a fresh pick', () => {
		const { canvas, fire } = fakeCanvas();
		const scene = sceneWithCube();
		const cube = scene.children[0] as THREE.Mesh;
		const onObjectSelected = vi.fn();
		const handlers = setupEventHandlers(canvas, scene, stubCameraController(), {
			events: { enableClickToFocus: true, selectionColor: '#ff0000', onObjectSelected }
		} as unknown as ResolvedOptions);

		handlers.selectEntries([{ object: cube, memberIndex: null }]);
		fire('mousedown', CENTRE);
		fire('click', CENTRE);

		expect(onObjectSelected).toHaveBeenCalledWith(cube);
		handlers.dispose();
	});
});

describe('setupEventHandlers viewer aids', () => {
	it('never picks the grid, whose camera-sized box would fling the camera out', () => {
		const { canvas, fire } = fakeCanvas();
		const scene = sceneWithCube();
		// As sized in grid.ts: a plane scaled to the fade radius, in front of the content.
		const grid = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial());
		grid.userData.id = 'grid';
		grid.position.set(0, 0, 5);
		grid.updateMatrixWorld(true);
		scene.add(grid);

		const controller = stubCameraController();
		const onMeshDoubleClicked = vi.fn();
		const config = {
			events: {
				enableClickToFocus: true,
				enableDoubleClickZoom: true,
				selectionColor: '#ff0000',
				onMeshDoubleClicked
			}
		} as unknown as ResolvedOptions;

		const handlers = setupEventHandlers(canvas, scene, controller, config);
		fire('dblclick', CENTRE);

		// The cube behind the grid is what gets framed, not the grid.
		expect(onMeshDoubleClicked).toHaveBeenCalledWith(scene.children[0]);
		const box = vi.mocked(controller.frameBounds).mock.calls[0][0];
		expect(box.getSize(new THREE.Vector3()).x).toBe(2);
		handlers.dispose();
	});
});
