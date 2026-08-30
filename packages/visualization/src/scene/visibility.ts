// ============================================================================
// Visibility: hidden-set bookkeeping over live THREE objects
// ============================================================================
//
// Hiding an object flips `.visible` on the object *and its whole subtree* (edge overlays and CSS2D
// labels are children, and three does not propagate `.visible` down for the label renderer), and
// records the fact in a hidden-set so the UI can render an eye-off state and compute per-layer
// tri-state.
//
// The set is keyed by stable identity (see `identity.ts`), not `uuid`, so hiding survives a solve —
// a solve regenerates uuids but not the minted ids the keys read. A merged mesh stores one key per
// source member, so re-merging under a different material/layer grouping can't lose the state.
// Objects with no identifying userData fall back to their uuid, so their hidden state lasts only
// until the next solve.

import type * as THREE from 'three';
import { getMemberKeys } from './identity.js';

// Backed by a caller-supplied `Set` so a reactive host can pass a framework-observable set
// (Svelte's `SvelteSet`) and get re-renders for free.
export interface VisibilityState {
	readonly hidden: Set<string>;
	isHidden(object: THREE.Object3D): boolean;
	setVisible(object: THREE.Object3D, visible: boolean): void;
	isLayerHidden(objects: THREE.Object3D[]): boolean;
	/** Drives the tri-state eye icon. */
	isLayerPartial(objects: THREE.Object3D[]): boolean;
	toggleLayer(objects: THREE.Object3D[]): void;
	/** Restores `.visible` on everything the user had hidden before the solve. Call after each solve. */
	applyTo(objects: THREE.Object3D[]): void;
	reset(): void;
}

export function createVisibilityState(hidden: Set<string> = new Set()): VisibilityState {
	// An object is hidden when EVERY member key is in the set — for a plain mesh that is its one
	// key; for a merged mesh it means all source members are hidden.
	const allHidden = (object: THREE.Object3D) =>
		getMemberKeys(object).every((key) => hidden.has(key));

	const state: VisibilityState = {
		hidden,

		isHidden: allHidden,

		setVisible(object, visible) {
			object.visible = visible;
			object.traverse((child) => {
				child.visible = visible;
			});
			for (const key of getMemberKeys(object)) {
				if (visible) hidden.delete(key);
				else hidden.add(key);
			}
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
				if (!allHidden(object)) continue;
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
