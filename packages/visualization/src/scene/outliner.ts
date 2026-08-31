// ============================================================================
// SceneOutliner: the object-list state machine over a live THREE.Scene
// ============================================================================
//
// Everything an outliner panel needs — content filtering, layer grouping, search, collapse,
// visibility and selection — with no DOM and no framework. A host renders `layerGroups()` and
// forwards clicks; see `SceneManager.svelte` in `@selvajs/ui` for the Svelte binding.

import type * as THREE from 'three';
import { getSceneObjects } from './objects.js';
import { getSceneEntries, type SceneEntry } from './entries.js';
import {
	DEFAULT_LAYER,
	filterEntryGroups,
	filterLayerGroups,
	groupByLayer,
	groupEntriesByLayer
} from './layers.js';
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

	/** Not memoized — recomputes from the scene on every call. */
	objects(): THREE.Object3D[];
	/**
	 * One entry per source object, which is what a panel lists. Merged meshes expand into their
	 * members, so an imported model shows its building elements rather than the handful of meshes
	 * they were merged into; everything else is one entry for itself.
	 */
	entries(): SceneEntry[];
	/** {@link layerGroups}, over entries. */
	entryGroups(searchQuery?: string): Map<string, SceneEntry[]>;
	/**
	 * Content grouped by layer, filtered by `searchQuery` (free text over layer and object
	 * names). The query is a parameter rather than outliner state so a host can derive this
	 * without writing back — mutating the outliner from a `$derived` is a Svelte error.
	 */
	layerGroups(searchQuery?: string): Map<string, THREE.Object3D[]>;

	isCollapsed(layerName: string): boolean;
	toggleCollapsed(layerName: string): void;

	/**
	 * Toggle one object's visibility. When the object is part of a multi-selection, the whole
	 * selection follows it — hiding one of five selected meshes hides all five.
	 */
	toggleObject(object: THREE.Object3D): void;

	/** {@link toggleObject}, for one entry — a whole object or a single merged member. */
	toggleEntry(entry: SceneEntry): void;

	/**
	 * Select by entry key (see {@link SceneEntry}) — a merged member is selectable on its own, so
	 * uuid would not distinguish siblings inside one mesh.
	 *
	 * Shift-ranges resolve against `flatVisibleUuids()`, not scene-graph order — so pass the
	 * same `searchQuery` the panel is displaying, or a range will span filtered-out objects.
	 */
	select(key: string, modifiers: SelectionModifiers, searchQuery?: string): void;

	/**
	 * Observe shift-range anchor moves, for hosts that mirror it into their own state.
	 * Convenience passthrough to `selection.onAnchorChange`.
	 *
	 * @returns An unsubscribe function.
	 */
	onAnchorChange(listener: (anchor: string | null) => void): () => void;

	/**
	 * The entry keys currently visible in the panel, in display order: every entry of every
	 * non-collapsed layer that survived the search filter. This is the span a shift-range walks.
	 */
	flatVisibleUuids(searchQuery?: string): string[];

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

		objects: () => getSceneObjects(scene),

		entries: () => getSceneEntries(scene, DEFAULT_LAYER),

		entryGroups: (searchQuery = '') =>
			filterEntryGroups(groupEntriesByLayer(getSceneEntries(scene, DEFAULT_LAYER)), searchQuery),

		layerGroups: (searchQuery = '') =>
			filterLayerGroups(groupByLayer(getSceneObjects(scene)), searchQuery),

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

		toggleEntry(entry) {
			if (selection.isSelected(entry.key) && selection.selected.size > 1) {
				const chosen = outliner.entries().filter((e) => selection.isSelected(e.key));
				const allHidden = chosen.every((e) => visibility.isEntryHidden(e));
				for (const e of chosen) visibility.setEntryVisible(e, allHidden);
			} else {
				visibility.setEntryVisible(entry, visibility.isEntryHidden(entry));
			}
		},

		select(key, modifiers, searchQuery) {
			selection.select(key, modifiers, () => outliner.flatVisibleUuids(searchQuery));
		},

		onAnchorChange: (listener) => selection.onAnchorChange(listener),

		flatVisibleUuids(searchQuery) {
			const result: string[] = [];
			for (const [layerName, entries] of outliner.entryGroups(searchQuery)) {
				if (collapsed.has(layerName)) continue;
				for (const entry of entries) result.push(entry.key);
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
