import * as THREE from 'three';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';

import type { CameraController } from './camera-controller';

/**
 * Corner nav-cube/axis gizmo. Uses three's {@link ViewHelper} only as the rendered widget, NOT its
 * click→animate behavior: ViewHelper's snap assumes Y-up and animates straight onto the up axis,
 * which rolls the view and jitters the gizmo at the pole in our Z-up scene. Instead we hit-test the
 * axis sprites ourselves and drive the viewer's up-aware camera controller, which snaps instantly
 * with a pole nudge so the orbit basis never degenerates.
 *
 * A click also frames the current orbit target (not the world origin), and flips the viewer back to
 * perspective first if it's in orthographic mode (the cube is inherently a 3D-orientation tool).
 *
 * Caller contract (mirrors ViewHelper's own): call {@link ViewGizmo.render} *after* the main scene
 * render each frame, and forward pointer clicks to {@link ViewGizmo.handleClick}.
 */
export interface ViewGizmo {
	render(renderer: THREE.WebGLRenderer): void;
	/** @deprecated No-op, kept only for API stability — this wrapper never animates (see module doc). */
	update(delta: number): void;
	/** Hit-test a click. Returns true if it hit the gizmo (and a view change started). */
	handleClick(event: MouseEvent): boolean;
	/** @deprecated Always `false`, kept only for API stability — gizmo clicks snap, never animate. */
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

	// Own hit-test against the helper's axis sprites (mirrors ViewHelper's internal `dim`×`dim`
	// corner-viewport math) instead of ViewHelper's own handleClick, so the move goes through the
	// viewer's up-aware controller rather than ViewHelper's Y-up-assuming animation (see module doc).
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
			// ViewHelper.render() calls renderer.render() with autoClear=true by default, which wipes
			// the FULL framebuffer before drawing the cube in its corner. Suppress it — ViewHelper
			// does its own depth clear internally.
			const prevAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			helper.render(renderer);
			renderer.autoClear = prevAutoClear;
		},
		// Deliberately a no-op: calling helper.update() outside a ViewHelper-driven animation would
		// rewrite camera.position from (center=origin, radius=0) and blank the view.
		update: () => {},
		handleClick,
		isAnimating: false,
		setVisible: (value) => {
			visible = value;
		},
		isVisible: () => visible,
		dispose: () => helper.dispose()
	};
}
