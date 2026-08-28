import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

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

	it('opens the metadata panel on a lone single click', () => {
		const { click, handlers, onMeshMetadataClicked } = setup();

		click();
		vi.runAllTimers();

		expect(onMeshMetadataClicked).toHaveBeenCalledTimes(1);
		handlers.dispose();
	});

	it('does not open the metadata panel when the click is part of a double-click', () => {
		const { click, fire, handlers, onMeshMetadataClicked, onMeshDoubleClicked } = setup();

		// A real double-click: two clicks then dblclick, all inside the pending-click window.
		click();
		click();
		fire('dblclick', CENTRE);
		vi.runAllTimers();

		expect(onMeshDoubleClicked).toHaveBeenCalledTimes(1);
		expect(onMeshMetadataClicked).not.toHaveBeenCalled();
		handlers.dispose();
	});

	it('drops a pending click on dispose', () => {
		const { click, handlers, onMeshMetadataClicked } = setup();

		click();
		handlers.dispose();
		vi.runAllTimers();

		expect(onMeshMetadataClicked).not.toHaveBeenCalled();
	});
});
