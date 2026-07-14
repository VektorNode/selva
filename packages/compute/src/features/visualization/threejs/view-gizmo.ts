import * as THREE from 'three';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';

import type { CameraController } from './camera-controller';

/**
 * The corner nav-cube/axis gizmo. Uses three's {@link ViewHelper} purely as the rendered widget, but
 * NOT its click→animate behavior: ViewHelper's built-in snap assumes a Y-up world and animates the
 * camera straight onto the up axis, which in our Z-up scene rolls the view and makes the gizmo jitter
 * at the pole. Instead we hit-test the axis sprites ourselves and drive the viewer's up-aware camera
 * controller, which snaps (no animation) with a pole nudge so the orbit basis never degenerates.
 *
 * Integration points with the viewer's dual-camera setup:
 *  1. The snap frames the current orbit target via the controller, so it rotates about what the user
 *     is looking at (not the world origin).
 *  2. The nav cube is inherently a 3D-orientation tool, so if the viewer is in orthographic (2D) mode
 *     when the gizmo is clicked, we first flip back to perspective.
 *
 * Caller responsibilities (mirror ViewHelper's own contract):
 *  - call {@link ViewGizmo.render} *after* the main scene render each frame (overlay viewport),
 *  - forward pointer clicks to {@link ViewGizmo.handleClick}.
 */
export interface ViewGizmo {
	render(renderer: THREE.WebGLRenderer): void;
	/**
	 * @deprecated No-op, kept only for API stability. This wrapper never uses ViewHelper's
	 * click→animate path (see module comment) — view changes snap instantly through the camera
	 * controller — so there is never a gizmo animation to advance. Safe to stop calling.
	 */
	update(delta: number): void;
	/** Hit-test a click. Returns true if it hit the gizmo (and a view change started). */
	handleClick(event: MouseEvent): boolean;
	/**
	 * @deprecated Always `false`, kept only for API stability. Gizmo clicks snap the view
	 * instantly rather than animating (deliberately — ViewHelper's built-in animation assumes a
	 * Y-up world and rolls the view in this Z-up scene), so there is no animation window to gate
	 * input on.
	 */
	readonly isAnimating: boolean;
	/** Show/hide the gizmo at runtime. Hidden = not rendered and not click-hittable. */
	setVisible(visible: boolean): void;
	isVisible(): boolean;
	dispose(): void;
}

interface ViewGizmoDeps {
	/** The perspective (primary) camera the gizmo visualizes and re-orients. */
	camera: THREE.PerspectiveCamera;
	domElement: HTMLElement;
	controller: CameraController;
}

export function createViewGizmo(deps: ViewGizmoDeps): ViewGizmo {
	const { camera, domElement, controller } = deps;

	const helper = new ViewHelper(camera, domElement);
	helper.setLabels('X', 'Y', 'Z');

	let visible = true;

	// Our own hit-test against the helper's axis sprites, mirroring ViewHelper's internal viewport math
	// (a `dim`×`dim` square in the corner given by `location`). We do this instead of ViewHelper's own
	// `handleClick` so the camera move goes through the viewer's up-aware controller — ViewHelper's
	// built-in snap assumes a Y-up world and animates straight onto the pole, which rolls the view and
	// makes the gizmo jitter in our Z-up scene.
	const DIM = 128;
	const raycaster = new THREE.Raycaster();
	const gizmoCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0, 4);
	gizmoCamera.position.set(0, 0, 2);
	// This camera is never rendered, so nothing else computes its matrixWorld — and
	// Raycaster.setFromCamera doesn't either. Without this the ray originates at the identity
	// position (z = 0, the cube's mid-plane) and the camera-facing axis sprites sit behind it.
	gizmoCamera.updateMatrixWorld();

	// Map a clicked axis sprite to the world-space view direction (from target toward camera).
	const AXIS_DIRECTIONS: Record<string, THREE.Vector3> = {
		posX: new THREE.Vector3(1, 0, 0),
		negX: new THREE.Vector3(-1, 0, 0),
		posY: new THREE.Vector3(0, 1, 0),
		negY: new THREE.Vector3(0, -1, 0),
		posZ: new THREE.Vector3(0, 0, 1),
		negZ: new THREE.Vector3(0, 0, -1)
	};

	/** Which axis sprite (if any) a click landed on. Returns its `userData.type` or null. */
	const pickAxis = (event: MouseEvent): string | null => {
		const rect = domElement.getBoundingClientRect();
		// The gizmo viewport sits in the bottom-right corner (helper.location defaults: right/bottom 0).
		const offsetX = rect.left + domElement.offsetWidth - DIM - helper.location.right;
		const offsetY = rect.top + domElement.offsetHeight - DIM - helper.location.bottom;

		const mouse = new THREE.Vector2(
			((event.clientX - offsetX) / DIM) * 2 - 1,
			-((event.clientY - offsetY) / DIM) * 2 + 1
		);
		// Outside the gizmo square — not our click.
		if (Math.abs(mouse.x) > 1 || Math.abs(mouse.y) > 1) return null;

		// Orient the helper as it's rendered (inverse of the camera), so the sprites are where the user
		// sees them, then raycast the interactive axis sprites.
		helper.quaternion.copy(camera.quaternion).invert();
		helper.updateMatrixWorld();

		raycaster.setFromCamera(mouse, gizmoCamera);
		const hits = raycaster.intersectObjects(helper.children, false);
		for (const hit of hits) {
			const type = hit.object.userData?.type;
			if (typeof type === 'string' && type in AXIS_DIRECTIONS) return type;
		}
		return null;
	};

	const handleClick = (event: MouseEvent): boolean => {
		if (!visible) return false;

		const axis = pickAxis(event);
		if (!axis) return false;

		// The cube orients in 3D, so a click while in 2D returns us to perspective first.
		if (controller.getProjection() === 'orthographic') {
			controller.setProjection('perspective');
		}

		// Snap directly via the up-aware controller — no animation, no Y-up pole roll.
		controller.setViewDirection(AXIS_DIRECTIONS[axis]!, false);
		return true;
	};

	return {
		render: (renderer) => {
			if (!visible) return;
			// ViewHelper.render() calls renderer.render(this, orthoCamera), which with the default
			// autoClear=true clears the FULL framebuffer (to the scene's grey clear color) before drawing
			// the cube in its corner viewport — wiping the just-rendered scene. It only needs the depth
			// clear it does internally (clearDepth). So suppress the automatic color/depth clear here.
			const prevAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			helper.render(renderer);
			renderer.autoClear = prevAutoClear;
		},
		// Deliberately a no-op (see the interface docs): ViewHelper.update() only exists to advance
		// its click-snap animation, which this wrapper never starts (handleClick snaps via the
		// camera controller instead). Calling helper.update() outside an animation would rewrite
		// camera.position from (center=origin, radius=0) and blank the view.
		update: () => {},
		handleClick,
		// Honestly constant (see the interface docs): nothing here ever animates.
		isAnimating: false,
		setVisible: (value) => {
			visible = value;
		},
		isVisible: () => visible,
		dispose: () => helper.dispose()
	};
}
