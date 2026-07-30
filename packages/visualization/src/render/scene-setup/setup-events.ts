import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import type { CameraController } from '../camera-controller.js';
import { computeContentBounds } from '../three-helpers.js';
import type { ResolvedOptions } from './defaults.js';

export function setupEventHandlers(
	canvas: HTMLCanvasElement,
	scene: THREE.Scene,
	cameraController: CameraController,
	config: ResolvedOptions
): {
	dispose: () => void;
	fitToView: () => void;
	clearSelection: () => void;
} {
	const selectedObjects = new Set<THREE.Object3D>();
	const originalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	const mouseDownPosition = new THREE.Vector2();
	const getActiveCamera = () => cameraController.getActiveCamera();

	// An object is hittable only if every ancestor is also visible. Three.js's
	// recursive intersect doesn't enforce that — it can hit a visible Mesh inside
	// a hidden Group.
	const isFullyVisible = (object: THREE.Object3D): boolean => {
		let current: THREE.Object3D | null = object;
		while (current) {
			if (!current.visible) return false;
			current = current.parent;
		}
		return true;
	};

	const fitToView = () => {
		// Frame the scene's renderable content; viewer aids (grid/floor/labels/measure) are excluded so
		// the camera-tracking grid plane can't dominate the bounds and blow up the fit distance.
		const box = computeContentBounds(scene);

		if (box.isEmpty()) {
			getLogger().warn('No objects to fit to view');
			return;
		}

		// Delegate the move to the camera controller: it frames from the current view direction and
		// repositions whichever camera is LIVE, re-deriving the ortho frustum in 2D mode — whereas
		// moving the perspective camera directly would change nothing visible in 2D (and silently
		// drag the invisible perspective camera out of sync).
		cameraController.frameBounds(box, false);
	};

	const selectionColorObj =
		typeof config.events.selectionColor === 'string'
			? new THREE.Color(config.events.selectionColor)
			: config.events.selectionColor instanceof THREE.Color
				? config.events.selectionColor
				: new THREE.Color('#ff0000');

	const clearSelection = () => {
		selectedObjects.forEach((obj) => {
			const restorable = obj as THREE.Object3D & {
				material?: THREE.Material | THREE.Material[];
			};
			if (originalMaterials.has(obj)) {
				const original = originalMaterials.get(obj)!;
				// Dispose the clone we swapped in before restoring the original.
				const clone = restorable.material;
				if (clone instanceof THREE.Material) clone.dispose();
				else if (Array.isArray(clone)) clone.forEach((m) => m.dispose());
				restorable.material = original;
				originalMaterials.delete(obj);

				// If the object left the scene while selected (a solve's clearScene only saw — and
				// disposed — the highlight clone), no later scene traversal can reach the original we
				// just restored, so it must be disposed here. Compute content is cleared wholesale per
				// solve, so a detached object's material has no surviving sharers.
				let root: THREE.Object3D = obj;
				while (root.parent) root = root.parent;
				if (root !== scene) {
					if (original instanceof THREE.Material) original.dispose();
					else original.forEach((m) => m.dispose());
				}
			}
		});
		selectedObjects.clear();
	};

	// Highlight a selected object by cloning its material and recoloring. Meshes get an `emissive`
	// tint (so the surface keeps its base color); lines and points have no emissive channel, so we
	// recolor `color` directly. Returns true if a highlight was applied (a material was found).
	const applyHighlight = (object: THREE.Object3D): boolean => {
		const target = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
		if (!(target.material instanceof THREE.Material)) return false;

		originalMaterials.set(object, target.material);
		const clone = target.material.clone();

		if (object instanceof THREE.Mesh && 'emissive' in clone) {
			(clone as THREE.MeshStandardMaterial).emissive = selectionColorObj.clone();
		} else if ('color' in clone) {
			(clone as THREE.LineBasicMaterial).color = selectionColorObj.clone();
		}

		target.material = clone;
		return true;
	};

	// Picking lines and points needs a ray-to-geometry tolerance, scaled to the scene so it holds at
	// any zoom. Plain THREE.Points use Raycaster.params.Points.threshold; fat Line2 uses its own
	// material linewidth, so only Points needs this. (THREE.Line would use params.Line.threshold, but
	// curves here are Line2.) Recomputed per pick from the current scene bounds.
	const updatePickThresholds = () => {
		const box = computeContentBounds(scene);
		const diagonal = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
		raycaster.params.Points.threshold = diagonal * 0.01;
	};

	const handleMouseDown = (event: MouseEvent) => {
		mouseDownPosition.set(event.clientX, event.clientY);
	};

	const handleCanvasClick = (event: MouseEvent) => {
		// Ignore if mouse has moved (drag)
		const currentMousePosition = new THREE.Vector2(event.clientX, event.clientY);
		if (mouseDownPosition.distanceTo(currentMousePosition) > 5) {
			return;
		}

		const rect = canvas.getBoundingClientRect();
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		updatePickThresholds();
		raycaster.setFromCamera(mouse, getActiveCamera());
		const intersects = raycaster
			.intersectObjects(scene.children, true)
			.filter((i) => isFullyVisible(i.object));

		if (intersects.length > 0) {
			const clickedObject = intersects[0].object;

			if (!selectedObjects.has(clickedObject)) {
				clearSelection();
				selectedObjects.add(clickedObject);

				// Clone material (so siblings sharing it are untouched) and recolor to highlight.
				// Handles meshes, fat lines, and points alike.
				applyHighlight(clickedObject);

				config.events?.onObjectSelected?.(clickedObject);

				if (clickedObject instanceof THREE.Mesh && Object.keys(clickedObject.userData).length > 0) {
					config.events?.onMeshMetadataClicked?.(clickedObject.userData);
				}
			}
		} else {
			clearSelection();
			config.events?.onBackgroundClicked?.({ x: mouse.x, y: mouse.y });
		}
	};

	const handleDoubleClick = (event: MouseEvent) => {
		const rect = canvas.getBoundingClientRect();
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		updatePickThresholds();
		raycaster.setFromCamera(mouse, getActiveCamera());
		const intersects = raycaster
			.intersectObjects(scene.children, true)
			.filter((i) => isFullyVisible(i.object));

		if (intersects.length === 0) return;

		const target = intersects[0].object;
		config.events?.onMeshDoubleClicked?.(target);

		if (!config.events?.enableDoubleClickZoom) return;

		const box = new THREE.Box3().setFromObject(target);
		if (box.isEmpty()) return;

		// Frame the clicked object via the controller so the ACTIVE camera moves (ortho included —
		// its frustum is re-derived, since translating an ortho camera alone zooms nothing). The
		// controller's tween is cancellable: a rapid second double-click replaces the first tween
		// instead of running a competing loop, and dispose() stops it outright.
		cameraController.frameBounds(box, true);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (!config.events?.enableKeyboardControls) return;

		switch (event.key.toLowerCase()) {
			case 'f':
				event.preventDefault();
				fitToView();
				break;
			case 'escape':
				event.preventDefault();
				clearSelection();
				break;
			case ' ':
				event.preventDefault();
				fitToView();
				break;
		}
	};

	if (config.events?.enableClickToFocus) {
		canvas.addEventListener('mousedown', handleMouseDown);
		canvas.addEventListener('click', handleCanvasClick);
		canvas.addEventListener('dblclick', handleDoubleClick);
	}

	if (config.events?.enableKeyboardControls) {
		canvas.setAttribute('tabindex', '0');
		canvas.addEventListener('keydown', handleKeydown);
	}

	const dispose = () => {
		canvas.removeEventListener('mousedown', handleMouseDown);
		canvas.removeEventListener('click', handleCanvasClick);
		canvas.removeEventListener('dblclick', handleDoubleClick);
		canvas.removeEventListener('keydown', handleKeydown);
		clearSelection();
	};

	return { dispose, fitToView, clearSelection };
}
