import * as THREE from 'three';

import { cloneForTint, getBaseMaterial, getLogger } from '../../shared/index.js';

import type { CameraController } from '../camera-controller.js';
import { raycastVisible } from '../scene-pick.js';
import { computeContentBounds } from '../three-helpers.js';
import {
	highlightMembers,
	memberBounds,
	membersOf,
	partsOfHit,
	resolveHitMember
} from './merged-picking.js';
import type { ResolvedOptions } from './defaults.js';
import type { TapTracker } from './tap-gesture.js';
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
 * Lighter than the default selection red on purpose: amber and red are close hues under red-green
 * color blindness, so what tells hover from selected there is brightness.
 */
const HOVER_COLOR = '#ffb020';
/**
 * A fingertip covers far more than the pixel under its centre, so a touch that lands just beside a
 * thin curve or a narrow part still picks it. Rings are sampled only when the centre misses.
 */
const TOUCH_PICK_RADII_PX = [8, 16];
const TOUCH_PICK_DIRECTIONS = 8;
/** Two taps closer than this in time and space are a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 30;
/** Linear RGB distance. Closer than this, a tint barely changes the surface. */
const MIN_TINT_DISTANCE = 0.35;
/** Taken by a surface already close to the tint. Blue stays distinct under every common deficiency. */
const FALLBACK_TINT = new THREE.Color('#2f7bff');

function readableTint(material: THREE.Material, tint: THREE.Color): THREE.Color {
	const base = (material as THREE.MeshStandardMaterial).color as THREE.Color | undefined;
	if (!base) return tint;
	const distance = Math.hypot(base.r - tint.r, base.g - tint.g, base.b - tint.b);
	return distance < MIN_TINT_DISTANCE ? FALLBACK_TINT : tint;
}

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
	color: THREE.Color,
	isMesh: boolean
): void {
	const selectionColor = readableTint(material, color);
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
	config: ResolvedOptions,
	taps: TapTracker
): {
	dispose: () => void;
	fitToView: () => void;
	clearSelection: () => void;
	selectEntries: (targets: SelectionTarget[]) => void;
	setHover: (
		target: THREE.Object3D | readonly SelectionTarget[] | null,
		memberIndex?: number | null
	) => void;
} {
	const selectedObjects = new Set<THREE.Object3D>();
	const originalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
	// One per merged mesh with selected members: restores the geometry's groups and material array,
	// which a plain material swap can't undo. Owns its highlight clone, which never becomes the
	// mesh's `material` and so isn't reached by the clone disposal below.
	const memberHighlights: { restore: () => void; material: THREE.Material }[] = [];
	/** What the last click landed on, so a click on a sibling member isn't a no-op. */
	let selectedHit: SelectionTarget | null = null;
	// True while `selectEntries` drew the selection: a click on one of those objects is a fresh pick,
	// not a re-click of what it already selected.
	let selectedByEntries = false;
	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	const getActiveCamera = () => cameraController.getActiveCamera();

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
	type Tintable = THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
	const hoverObjects: { object: Tintable; original: THREE.Material | THREE.Material[] }[] = [];
	const hoverMembers: { restore: () => void; material: THREE.Material }[] = [];

	// If the object left the scene, no traversal can reach the original material just restored to
	// it, so dispose it here. Compute content is cleared wholesale per solve, so a detached object's
	// material has no surviving sharers.
	const disposeIfDetached = (
		object: THREE.Object3D,
		original: THREE.Material | THREE.Material[]
	) => {
		let root = object;
		while (root.parent) root = root.parent;
		if (root === scene) return;
		if (original instanceof THREE.Material) original.dispose();
		else original.forEach((m) => m.dispose());
	};

	const clearHover = () => {
		for (const { restore, material } of hoverMembers) {
			restore();
			material.dispose();
		}
		hoverMembers.length = 0;
		for (const { object, original } of hoverObjects) {
			const clone = object.material;
			if (clone instanceof THREE.Material) clone.dispose();
			object.material = original;
			disposeIfDetached(object, original);
		}
		hoverObjects.length = 0;
	};

	/** Members grouped per merged mesh, whole objects apart: a mesh takes one highlight for all its members. */
	const groupTargets = (targets: readonly SelectionTarget[]) => {
		const whole: THREE.Object3D[] = [];
		const membersByMesh = new Map<THREE.Object3D, Set<number>>();
		for (const { object, memberIndex } of targets) {
			if (memberIndex === null) {
				whole.push(object);
				continue;
			}
			let members = membersByMesh.get(object);
			if (!members) membersByMesh.set(object, (members = new Set()));
			members.add(memberIndex);
		}
		return { whole, membersByMesh };
	};

	/**
	 * Previews an outliner row in the viewport. Fires no events, and yields to a selection already
	 * tinting the same thing. A row drawn as several meshes passes every part.
	 */
	const setHover = (
		target: THREE.Object3D | readonly SelectionTarget[] | null,
		memberIndex: number | null = null
	) => {
		clearHover();
		if (!target) return;

		const targets = target instanceof THREE.Object3D ? [{ object: target, memberIndex }] : target;
		const { whole, membersByMesh } = groupTargets(targets);
		for (const [object, members] of membersByMesh) {
			if (!(object instanceof THREE.Mesh)) {
				whole.push(object);
				continue;
			}
			const material = getBaseMaterial(object).clone();
			tintForSelection(material, hoverColorObj, true);
			hoverMembers.push({
				restore: highlightMembers(object, members, material, 'hover'),
				material
			});
		}
		for (const object of whole) {
			if (selectedObjects.has(object)) continue;
			const tintable = object as Tintable;
			if (!(tintable.material instanceof THREE.Material)) continue;
			const clone = cloneForTint(tintable.material);
			tintForSelection(clone, hoverColorObj, object instanceof THREE.Mesh);
			hoverObjects.push({ object: tintable, original: tintable.material });
			tintable.material = clone;
		}
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

				disposeIfDetached(obj, original);
			}
		});
		selectedObjects.clear();
		selectedHit = null;
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

		const clone = cloneForTint(target.material);
		tintForSelection(clone, selectionColorObj, object instanceof THREE.Mesh);

		originalMaterials.set(object, target.material);
		target.material = clone;
		return true;
	};

	const highlightTargets = (targets: readonly SelectionTarget[]) => {
		const { whole, membersByMesh } = groupTargets(targets);
		for (const object of whole) {
			selectedObjects.add(object);
			applyHighlight(object, null);
		}
		for (const [object, members] of membersByMesh) {
			selectedObjects.add(object);
			applyHighlight(object, members);
		}
	};

	/**
	 * Selection made outside the viewport. An empty list only drops such a selection, so a host
	 * syncing its own empty state can't wipe what a click on the canvas just selected.
	 */
	const selectEntries = (targets: SelectionTarget[]) => {
		if (targets.length === 0 && !selectedByEntries) return;

		clearHover();
		clearSelection();
		highlightTargets(targets);
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

	const setPointerNdc = (clientX: number, clientY: number) => {
		const rect = canvas.getBoundingClientRect();
		mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
	};

	/**
	 * Nearest visible, pickable object under the pointer, or null. Goes through the BVH pick, which
	 * also skips viewer aids: the grid is a huge camera-following plane, so double-clicking through
	 * a thin curve onto it would frame a box the size of the fade radius and fling the camera out.
	 */
	const pickAt = (clientX: number, clientY: number): THREE.Intersection | null => {
		setPointerNdc(clientX, clientY);
		updatePickThresholds();
		raycaster.setFromCamera(mouse, getActiveCamera());
		return raycastVisible(scene, raycaster)[0] ?? null;
	};

	const pickNear = (clientX: number, clientY: number, touch: boolean) => {
		const centre = pickAt(clientX, clientY);
		if (centre || !touch) return centre;
		for (const radius of TOUCH_PICK_RADII_PX) {
			let nearest: THREE.Intersection | null = null;
			for (let i = 0; i < TOUCH_PICK_DIRECTIONS; i++) {
				const angle = (i / TOUCH_PICK_DIRECTIONS) * Math.PI * 2;
				const hit = pickAt(clientX + Math.cos(angle) * radius, clientY + Math.sin(angle) * radius);
				if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
			}
			if (nearest) return nearest;
		}
		return null;
	};

	let lastTap: { time: number; x: number; y: number } | null = null;
	/** iOS fires no `dblclick` for a double-tap, so touch pairs its own taps. */
	const isSecondTap = (event: MouseEvent): boolean => {
		const previous = lastTap;
		lastTap = { time: event.timeStamp, x: event.clientX, y: event.clientY };
		if (!previous) return false;
		const isDouble =
			event.timeStamp - previous.time <= DOUBLE_TAP_MS &&
			Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= DOUBLE_TAP_SLOP_PX;
		if (isDouble) lastTap = null;
		return isDouble;
	};

	const handleCanvasClick = (event: MouseEvent) => {
		if (!taps.wasTap()) return;
		const touch = taps.pointerType() !== 'mouse';
		if (touch && isSecondTap(event)) {
			handleDoubleTap(event.clientX, event.clientY, true);
			return;
		}

		// Acted on immediately, including the first press of a double-click: selecting and reporting
		// metadata are idempotent, so the second press re-reports the same object. Deferring this to
		// wait out a possible `dblclick` made every selection feel a quarter-second late.
		const hit = pickNear(event.clientX, event.clientY, touch);

		if (!hit) {
			clearSelection();
			setPointerNdc(event.clientX, event.clientY);
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
			selectedHit?.object === clickedObject &&
			selectedHit.memberIndex === hitMemberIndex
		) {
			return;
		}

		clearHover();
		clearSelection();
		selectedHit = { object: clickedObject, memberIndex: hitMemberIndex };
		// Every mesh of the clicked object: one drawn in two materials arrives as two.
		highlightTargets(partsOfHit(scene, hit));

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
		// Touch double-taps are paired in `handleCanvasClick`; Android's own `dblclick` would repeat it.
		if (!taps.wasTap() || taps.pointerType() !== 'mouse') return;
		handleDoubleTap(event.clientX, event.clientY, false);
	};

	const handleDoubleTap = (clientX: number, clientY: number, touch: boolean) => {
		const hit = pickNear(clientX, clientY, touch);
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
		// member under the cursor instead, with its other parts.
		const box = new THREE.Box3();
		for (const { object, memberIndex } of partsOfHit(scene, hit)) {
			const member = memberIndex === null ? null : membersOf(object)?.[memberIndex];
			box.union(
				member && object instanceof THREE.Mesh
					? memberBounds(object, member)
					: new THREE.Box3().setFromObject(object)
			);
		}
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
		canvas.addEventListener('click', handleCanvasClick);
		canvas.addEventListener('dblclick', handleDoubleClick);
	}

	if (config.events?.enableKeyboardControls) {
		canvas.setAttribute('tabindex', '0');
		canvas.addEventListener('keydown', handleKeydown);
	}

	const dispose = () => {
		canvas.removeEventListener('click', handleCanvasClick);
		canvas.removeEventListener('dblclick', handleDoubleClick);
		canvas.removeEventListener('keydown', handleKeydown);
		clearHover();
		clearSelection();
	};

	return { dispose, fitToView, clearSelection, selectEntries, setHover };
}
