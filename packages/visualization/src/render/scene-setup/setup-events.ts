import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import type { CameraController } from '../camera-controller.js';
import { computeContentBounds } from '../three-helpers.js';
import type { ResolvedOptions } from './defaults.js';

// Tuned against the brightest look (`showcase`, exposure 1.15 + sun 2.6): the highlight has to stay
// obvious there without blowing out to a flat silhouette under the dimmest one.
/** How far the base color moves toward the selection color. 1 would discard the texture underneath. */
const SELECTION_COLOR_MIX = 0.75;
/** Above ~2 the tint clips to pure red and the geometry's shading disappears with it. */
const SELECTION_EMISSIVE_INTENSITY = 0.6;
/** A metallic surface reflects the environment rather than showing its albedo tint. */
const SELECTION_MAX_METALNESS = 0.2;
/** Below this a highlight reads as a ghost, so the selection is forced opaque. */
const SELECTION_MIN_OPACITY = 1;

/**
 * Recolors a material clone to mark it selected. Exported for tests: the highlight reads against
 * whatever the active look does to lighting, and that coupling has broken it silently before.
 *
 * Meshes tint via `emissive` AND base color. Emissive alone is additive on top of what the surface
 * already reflects, so on a bright white model under a key light it only shifts the surface slightly
 * pink — the brighter the look, the weaker the highlight. Moving the albedo toward the selection
 * color is what makes it hold at any exposure; the emissive on top keeps it reading as lit rather
 * than as a flat sticker in shadowed areas. Lines/points have no emissive channel, so their `color`
 * is replaced outright.
 *
 * Mutates `material` in place — pass a clone, never a material the scene still shares.
 */
export function tintForSelection(
	material: THREE.Material,
	selectionColor: THREE.Color,
	isMesh: boolean
): void {
	if (isMesh && 'emissive' in material) {
		const mesh = material as THREE.MeshStandardMaterial;
		mesh.emissive = selectionColor.clone();
		mesh.emissiveIntensity = SELECTION_EMISSIVE_INTENSITY;
		// A textured surface keeps its map; tinting the base color under it still reads.
		mesh.color.lerp(selectionColor, SELECTION_COLOR_MIX);
		// Chrome-like input would reflect the environment instead of showing the tint.
		mesh.metalness = Math.min(mesh.metalness, SELECTION_MAX_METALNESS);
		// Under the x-ray look every mesh is near-transparent with depth writes off, which would
		// leave the selection a faint ghost sorted behind its own neighbours. Selection is a UI
		// affordance, so it opts out of the look and renders solid.
		if (mesh.opacity < SELECTION_MIN_OPACITY) {
			mesh.opacity = SELECTION_MIN_OPACITY;
			mesh.transparent = false;
			mesh.depthWrite = true;
		}
		return;
	}
	if ('color' in material) {
		(material as THREE.LineBasicMaterial).color = selectionColor.clone();
	}
}

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

	// Three.js's recursive intersect hits a visible Mesh inside a hidden Group; this enforces that
	// every ancestor must also be visible.
	const isFullyVisible = (object: THREE.Object3D): boolean => {
		let current: THREE.Object3D | null = object;
		while (current) {
			if (!current.visible) return false;
			current = current.parent;
		}
		return true;
	};

	const fitToView = () => {
		const box = computeContentBounds(scene);

		if (box.isEmpty()) {
			getLogger().warn('No objects to fit to view');
			return;
		}

		// Via the controller, not the perspective camera directly: it repositions whichever camera is
		// live and re-derives the ortho frustum in 2D mode.
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
				const clone = restorable.material; // dispose the highlight clone before restoring
				if (clone instanceof THREE.Material) clone.dispose();
				else if (Array.isArray(clone)) clone.forEach((m) => m.dispose());
				restorable.material = original;
				originalMaterials.delete(obj);

				// If the object left the scene while selected, no traversal can reach the original
				// material we just restored — dispose it here. Compute content is cleared wholesale
				// per solve, so a detached object's material has no surviving sharers.
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

	const applyHighlight = (object: THREE.Object3D): boolean => {
		const target = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
		if (!(target.material instanceof THREE.Material)) return false;

		originalMaterials.set(object, target.material);
		const clone = target.material.clone();
		tintForSelection(clone, selectionColorObj, object instanceof THREE.Mesh);
		target.material = clone;
		return true;
	};

	// Points picking tolerance, scaled to scene size so it holds at any zoom. Fat Line2 uses its own
	// material linewidth instead, so no separate threshold is needed for lines.
	const updatePickThresholds = () => {
		const box = computeContentBounds(scene);
		const diagonal = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
		raycaster.params.Points.threshold = diagonal * 0.01;
	};

	const handleMouseDown = (event: MouseEvent) => {
		mouseDownPosition.set(event.clientX, event.clientY);
	};

	// `click` fires on the first press of a double-click too, so acting on it immediately would
	// select the mesh and open its metadata before `dblclick` ever arrives. Hold the single-click
	// action for one double-click interval; `handleDoubleClick` cancels it.
	const DOUBLE_CLICK_MS = 250;
	let pendingClick: ReturnType<typeof setTimeout> | null = null;

	const cancelPendingClick = () => {
		if (pendingClick === null) return;
		clearTimeout(pendingClick);
		pendingClick = null;
	};

	const handleCanvasClick = (event: MouseEvent) => {
		const currentMousePosition = new THREE.Vector2(event.clientX, event.clientY);
		if (mouseDownPosition.distanceTo(currentMousePosition) > 5) {
			return;
		}

		// `event` is reused by the browser after this handler returns, so read what the deferred
		// work needs now rather than closing over the event itself.
		const { clientX, clientY } = event;
		cancelPendingClick();
		pendingClick = setTimeout(() => {
			pendingClick = null;
			resolveClick(clientX, clientY);
		}, DOUBLE_CLICK_MS);
	};

	const resolveClick = (clientX: number, clientY: number) => {
		const rect = canvas.getBoundingClientRect();
		mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

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
		cancelPendingClick();

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

		// Via the controller so the active camera moves (translating an ortho camera alone zooms
		// nothing). The resulting tween is cancellable — a rapid second double-click replaces it
		// rather than racing it.
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
		cancelPendingClick();
		canvas.removeEventListener('mousedown', handleMouseDown);
		canvas.removeEventListener('click', handleCanvasClick);
		canvas.removeEventListener('dblclick', handleDoubleClick);
		canvas.removeEventListener('keydown', handleKeydown);
		clearSelection();
	};

	return { dispose, fitToView, clearSelection };
}
