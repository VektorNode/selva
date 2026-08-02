// ============================================================================
// SceneOutliner: the object-list state machine over a live THREE.Scene
// ============================================================================
//
// Everything an outliner panel needs — content filtering, layer grouping, search, collapse,
// visibility and selection — with no DOM and no framework. A host renders `layerGroups()` and
// forwards clicks; see `SceneManager.svelte` in `@selvajs/ui` for the Svelte binding.

import type * as THREE from 'three';
import { getSceneObjects } from './objects.js';
import { filterLayerGroups, groupByLayer } from './layers.js';
import { createVisibilityState, type VisibilityState } from './visibility.js';
import { createSelectionState, type SelectionModifiers, type SelectionState } from './selection.js';

export interface SceneOutlinerOptions {
	/**
	 * Backing sets for the mutable state. Supply framework-observable sets (e.g. Svelte's
	 * `SvelteSet`) to make a host re-render on mutation; omit for plain `Set`s.
	 */
	sets?: {
		hidden?: Set<string>;
		selected?: Set<string>;
		collapsed?: Set<string>;
	};
}

export interface SceneOutliner {
	readonly visibility: VisibilityState;
	readonly selection: SelectionState;
	readonly collapsed: Set<string>;

	/** Free-text search over layer and object names. */
	searchQuery: string;

	/** Not memoized — recomputes from the scene on every call. */
	objects(): THREE.Object3D[];
	/** Content grouped by layer, after the search filter. */
	layerGroups(): Map<string, THREE.Object3D[]>;

	isCollapsed(layerName: string): boolean;
	toggleCollapsed(layerName: string): void;

	/**
	 * Toggle one object's visibility. When the object is part of a multi-selection, the whole
	 * selection follows it — hiding one of five selected meshes hides all five.
	 */
	toggleObject(object: THREE.Object3D): void;

	/** Shift-ranges resolve against `flatVisibleUuids()`, not scene-graph order. */
	select(uuid: string, modifiers: SelectionModifiers): void;

	/**
	 * Observe shift-range anchor moves, for hosts that mirror it into their own state.
	 * Convenience passthrough to `selection.onAnchorChange`.
	 *
	 * @returns An unsubscribe function.
	 */
	onAnchorChange(listener: (anchor: string | null) => void): () => void;

	/**
	 * The uuids currently visible in the panel, in display order: every object of every
	 * non-collapsed layer that survived the search filter. This is the span a shift-range walks.
	 */
	flatVisibleUuids(): string[];

	/**
	 * Re-apply hidden state to freshly built scene content. **Call after every solve.**
	 *
	 * A solve discards all content and rebuilds it, so whatever the user had hidden comes back
	 * visible unless it is hidden again. Hidden state is keyed by stable identity rather than
	 * instance uuid, so this restores it (see `identity.ts`). Selection is dropped: it refers to
	 * object instances that no longer exist, and a persistent selection across solves is not a
	 * behaviour anyone asked for.
	 */
	applyTo(): void;

	/** Drop all hidden and selected state, showing everything. Objects are left as they are. */
	reset(): void;
}

export function createSceneOutliner(
	scene: THREE.Scene,
	options: SceneOutlinerOptions = {}
): SceneOutliner {
	const collapsed = options.sets?.collapsed ?? new Set<string>();
	const visibility = createVisibilityState(options.sets?.hidden);
	const selection = createSelectionState(options.sets?.selected);

	const outliner: SceneOutliner = {
		visibility,
		selection,
		collapsed,
		searchQuery: '',

		objects: () => getSceneObjects(scene),

		layerGroups: () =>
			filterLayerGroups(groupByLayer(getSceneObjects(scene)), outliner.searchQuery),

		isCollapsed: (layerName) => collapsed.has(layerName),

		toggleCollapsed(layerName) {
			if (collapsed.has(layerName)) collapsed.delete(layerName);
			else collapsed.add(layerName);
		},

		toggleObject(object) {
			if (selection.isSelected(object.uuid) && selection.selected.size > 1) {
				const chosen = outliner.objects().filter((o) => selection.isSelected(o.uuid));
				// Show the group only once every member is hidden, matching the per-layer rule.
				const allHidden = chosen.every((o) => visibility.isHidden(o));
				for (const o of chosen) visibility.setVisible(o, allHidden);
			} else {
				visibility.setVisible(object, visibility.isHidden(object));
			}
		},

		select(uuid, modifiers) {
			selection.select(uuid, modifiers, () => outliner.flatVisibleUuids());
		},

		onAnchorChange: (listener) => selection.onAnchorChange(listener),

		flatVisibleUuids() {
			const result: string[] = [];
			for (const [layerName, objects] of outliner.layerGroups()) {
				if (collapsed.has(layerName)) continue;
				for (const obj of objects) result.push(obj.uuid);
			}
			return result;
		},

		applyTo() {
			visibility.applyTo(outliner.objects());
			selection.clear();
		},

		reset() {
			visibility.reset();
			selection.clear();
		}
	};

	return outliner;
}
