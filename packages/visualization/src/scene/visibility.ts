// ============================================================================
// Visibility: hidden-set bookkeeping over live THREE objects
// ============================================================================
//
// Hiding an object means two things at once: flipping `.visible` on the object *and its whole
// subtree* (edge overlays and CSS2D labels are children, and three does not propagate `.visible`
// down for the label renderer), and recording the fact in a hidden-set so the UI can render an
// eye-off state and compute per-layer tri-state.
//
// The set is keyed by stable identity (see `identity.ts`), not by `uuid`, so hiding survives a
// solve: a solve throws away every object and rebuilds it, which regenerates uuids but not the
// Grasshopper source the key is derived from. Objects with no identifying userData fall back to
// their uuid, which means their hidden state lasts only until the next solve — the old behaviour,
// now limited to the objects that genuinely cannot be tracked.

import type * as THREE from 'three';
import { getTrackingKey as hiddenKey } from './identity.js';

/**
 * Mutable hidden-object bookkeeping. Backed by a caller-supplied `Set`, so a reactive host can pass
 * a framework-observable set (Svelte's `SvelteSet`) and get re-renders for free.
 */
export interface VisibilityState {
	/**
	 * Keys of the hidden objects — stable identities, not uuids. Entries may refer to geometry that
	 * the current solve did not produce; hiding is remembered so it applies again if the geometry
	 * returns. See `applyTo`.
	 */
	readonly hidden: Set<string>;
	isHidden(object: THREE.Object3D): boolean;
	/** Set `.visible` across the object's subtree and record it in the hidden set. */
	setVisible(object: THREE.Object3D, visible: boolean): void;
	/** Every object in the layer is hidden. */
	isLayerHidden(objects: THREE.Object3D[]): boolean;
	/** Some — but not all — of the layer is hidden. Drives the tri-state eye icon. */
	isLayerPartial(objects: THREE.Object3D[]): boolean;
	/** Hide a whole layer, or show it again once fully hidden. */
	toggleLayer(objects: THREE.Object3D[]): void;
	/**
	 * Re-apply the hidden set to freshly built scene content, restoring `.visible` on everything the
	 * user had hidden before the solve. Call after each solve; see `SceneOutliner.applyTo`.
	 */
	applyTo(objects: THREE.Object3D[]): void;
	/** Forget all hidden state. Objects are left as they are. */
	reset(): void;
}

export function createVisibilityState(hidden: Set<string> = new Set()): VisibilityState {
	const state: VisibilityState = {
		hidden,

		isHidden: (object) => hidden.has(hiddenKey(object)),

		setVisible(object, visible) {
			object.visible = visible;
			object.traverse((child) => {
				child.visible = visible;
			});
			const key = hiddenKey(object);
			if (visible) hidden.delete(key);
			else hidden.add(key);
		},

		isLayerHidden: (objects) => objects.length > 0 && objects.every((obj) => state.isHidden(obj)),

		isLayerPartial(objects) {
			const count = objects.filter((obj) => state.isHidden(obj)).length;
			return count > 0 && count < objects.length;
		},

		toggleLayer(objects) {
			// A partially hidden layer hides the rest — only a fully hidden layer comes back.
			const show = state.isLayerHidden(objects);
			for (const obj of objects) state.setVisible(obj, show);
		},

		applyTo(objects) {
			for (const object of objects) {
				// Only push objects down. Anything not in the set keeps whatever visibility the render
				// layer gave it, so this never fights another feature that hid something for its own
				// reasons (isolate mode, section-box culling).
				if (!hidden.has(hiddenKey(object))) continue;
				object.visible = false;
				object.traverse((child) => {
					child.visible = false;
				});
			}
		},

		reset: () => hidden.clear()
	};
	return state;
}
