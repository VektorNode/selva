import * as THREE from 'three';

import { getBaseMaterial, getLogger } from '../../shared/index.js';

import type { CameraController } from '../camera-controller.js';
import { computeContentBounds, isViewerAid } from '../three-helpers.js';
import { highlightMembers, memberBounds, resolveHitMember } from './merged-picking.js';
import type { ResolvedOptions } from './defaults.js';
import { HOVER_COLOR } from './hover-outline.js';
import type { SelectionTarget } from './viewer.js';

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
	selectEntries: (targets: SelectionTarget[]) => void;
	setHoverTint: (object: THREE.Object3D | null) => void;
} {
	const selectedObjects = new Set<THREE.Object3D>();
	const originalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
	// One per merged mesh with selected members: restores the geometry's groups and material array,
	// which a plain material swap can't undo. Owns its highlight clone, which never becomes the
	// mesh's `material` and so isn't reached by the clone disposal below.
	const memberHighlights: { restore: () => void; material: THREE.Material }[] = [];
	/** Which member of a merged mesh is selected, so a click on a sibling isn't a no-op. */
	let selectedMemberIndex: number | null = null;
	// True while `selectEntries` drew the selection: a click on one of those objects is a fresh pick,
	// not a re-click of what it already selected.
	let selectedByEntries = false;
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

	const hoverColorObj = new THREE.Color(HOVER_COLOR);
	let hoverObject: (THREE.Object3D & { material?: THREE.Material | THREE.Material[] }) | null =
		null;
	let hoverOriginal: THREE.Material | THREE.Material[] | null = null;

	const clearHover = () => {
		if (hoverObject && hoverOriginal) {
			const clone = hoverObject.material;
			if (clone instanceof THREE.Material) clone.dispose();
			hoverObject.material = hoverOriginal;
		}
		hoverObject = null;
		hoverOriginal = null;
	};

	/** Hover for what can't be outlined. Yields to a selection already tinting the same object. */
	const setHoverTint = (object: THREE.Object3D | null) => {
		clearHover();
		if (!object || selectedObjects.has(object)) return;
		const target = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
		if (!(target.material instanceof THREE.Material)) return;
		const clone = target.material.clone();
		tintForSelection(clone, hoverColorObj, object instanceof THREE.Mesh);
		hoverObject = target;
		hoverOriginal = target.material;
		target.material = clone;
	};

	const clearSelection = () => {
		for (const { restore, material } of memberHighlights) {
			restore();
			material.dispose();
		}
		memberHighlights.length = 0;
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
		selectedMemberIndex = null;
		selectedByEntries = false;
	};

	/**
	 * Tints the picked object. On a merged mesh only the given members are tinted, so clicking one
	 * wall doesn't light up every wall sharing its material — see `merged-picking.ts`.
	 */
	const applyHighlight = (object: THREE.Object3D, members: ReadonlySet<number> | null): boolean => {
		if (members && object instanceof THREE.Mesh) {
			// The material is an array while some members are hidden, so read the base through
			// the draw-state owner rather than off the mesh.
			const clone = getBaseMaterial(object).clone();
			tintForSelection(clone, selectionColorObj, true);
			memberHighlights.push({
				restore: highlightMembers(object, members, clone),
				material: clone
			});
			return true;
		}

		const target = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
		if (!(target.material instanceof THREE.Material)) return false;

		const clone = target.material.clone();
		tintForSelection(clone, selectionColorObj, object instanceof THREE.Mesh);

		originalMaterials.set(object, target.material);
		target.material = clone;
		return true;
	};

	/**
	 * Selection made outside the viewport. An empty list only drops such a selection, so a host
	 * syncing its own empty state can't wipe what a click on the canvas just selected.
	 */
	const selectEntries = (targets: SelectionTarget[]) => {
		if (targets.length === 0 && !selectedByEntries) return;

		clearHover();
		clearSelection();

		const membersByMesh = new Map<THREE.Object3D, Set<number>>();
		for (const { object, memberIndex } of targets) {
			if (memberIndex === null) {
				selectedObjects.add(object);
				applyHighlight(object, null);
				continue;
			}
			let members = membersByMesh.get(object);
			if (!members) membersByMesh.set(object, (members = new Set()));
			members.add(memberIndex);
		}
		for (const [object, members] of membersByMesh) {
			selectedObjects.add(object);
			applyHighlight(object, members);
		}
		selectedByEntries = targets.length > 0;
	};

	// Points picking tolerance, scaled to scene size so it holds at any zoom. Fat Line2 uses its own
	// material linewidth instead, so no separate threshold is needed for lines.
	//
	// `computeContentBounds` traverses the whole scene, which is far too slow to redo on every
	// click. The scene only changes wholesale between solves, so the diagonal is cached and
	// recomputed when the child count changes.
	let cachedDiagonal: number | null = null;
	let cachedChildCount = -1;
	const updatePickThresholds = () => {
		if (cachedDiagonal === null || scene.children.length !== cachedChildCount) {
			const box = computeContentBounds(scene);
			cachedDiagonal = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
			cachedChildCount = scene.children.length;
		}
		raycaster.params.Points.threshold = cachedDiagonal * 0.01;
	};

	/**
	 * Nearest visible, pickable object under the pointer, or null. Viewer aids are excluded: the grid
	 * is a huge camera-following plane, so double-clicking through a thin curve onto it would frame a
	 * box the size of the fade radius and fling the camera out.
	 */
	const pickAt = (clientX: number, clientY: number): THREE.Intersection | null => {
		const rect = canvas.getBoundingClientRect();
		mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

		updatePickThresholds();
		raycaster.setFromCamera(mouse, getActiveCamera());
		// Sorted near-to-far, so the first visible hit is the nearest one.
		for (const hit of raycaster.intersectObjects(scene.children, true)) {
			if (isFullyVisible(hit.object) && !isViewerAid(hit.object)) return hit;
		}
		return null;
	};

	const handleMouseDown = (event: MouseEvent) => {
		mouseDownPosition.set(event.clientX, event.clientY);
	};

	const handleCanvasClick = (event: MouseEvent) => {
		const currentMousePosition = new THREE.Vector2(event.clientX, event.clientY);
		if (mouseDownPosition.distanceTo(currentMousePosition) > 5) {
			return;
		}

		// Acted on immediately, including the first press of a double-click: selecting and reporting
		// metadata are idempotent, so the second press re-reports the same object. Deferring this to
		// wait out a possible `dblclick` made every selection feel a quarter-second late.
		const hit = pickAt(event.clientX, event.clientY);

		if (!hit) {
			clearSelection();
			config.events?.onBackgroundClicked?.({ x: mouse.x, y: mouse.y });
			return;
		}

		const clickedObject = hit.object;
		const resolved = resolveHitMember(hit);
		const hitMemberIndex = resolved?.index ?? null;

		// A merged mesh stays one object across clicks, so object identity alone would treat a click
		// on a different member as re-clicking the current selection and do nothing.
		if (
			!selectedByEntries &&
			selectedObjects.has(clickedObject) &&
			hitMemberIndex === selectedMemberIndex
		) {
			return;
		}

		clearHover();
		clearSelection();
		selectedObjects.add(clickedObject);
		selectedMemberIndex = hitMemberIndex;
		applyHighlight(clickedObject, resolved ? new Set([resolved.index]) : null);

		config.events?.onObjectSelected?.(clickedObject);

		// The member's own name/layer/metadata, so the panel describes the object under the cursor
		// rather than the merged group's first member.
		if (resolved) {
			config.events?.onMeshMetadataClicked?.({
				source: clickedObject.userData?.source,
				name: resolved.member.name,
				layer: resolved.member.layer,
				trackingKey: resolved.member.trackingKey,
				metadata: resolved.member.metadata
			});
		} else if (
			clickedObject instanceof THREE.Mesh &&
			Object.keys(clickedObject.userData).length > 0
		) {
			config.events?.onMeshMetadataClicked?.(clickedObject.userData);
		}
	};

	const handleDoubleClick = (event: MouseEvent) => {
		const hit = pickAt(event.clientX, event.clientY);
		if (!hit) {
			// The way back out after framing a part. On touch there is no F key, and a pinch-out
			// from a small part back to the whole model takes many gestures.
			if (config.events?.enableDoubleClickZoom) {
				cameraController.frameBounds(computeContentBounds(scene), true);
			}
			return;
		}
		const target = hit.object;

		config.events?.onMeshDoubleClicked?.(target);

		if (!config.events?.enableDoubleClickZoom) return;

		// On a merged mesh, framing the object would frame the whole material group; frame just the
		// member under the cursor instead.
		const resolved = resolveHitMember(hit);
		const box =
			resolved && target instanceof THREE.Mesh
				? memberBounds(target, resolved.member)
				: new THREE.Box3().setFromObject(target);
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
		canvas.removeEventListener('mousedown', handleMouseDown);
		canvas.removeEventListener('click', handleCanvasClick);
		canvas.removeEventListener('dblclick', handleDoubleClick);
		canvas.removeEventListener('keydown', handleKeydown);
		clearHover();
		clearSelection();
	};

	return { dispose, fitToView, clearSelection, selectEntries, setHoverTint };
}
