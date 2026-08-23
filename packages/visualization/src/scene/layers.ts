// ============================================================================
// Layer grouping and search filtering
// ============================================================================

import type * as THREE from 'three';
import { getObjectLabel } from './objects.js';

export const DEFAULT_LAYER = 'Default';

/**
 * Group content objects by their Grasshopper layer.
 *
 * `userData.layer` wins over `userData.category`; objects with neither land in {@link DEFAULT_LAYER}.
 * Insertion order is preserved, so the grouping follows scene-graph order rather than sorting
 * alphabetically — the order geometry was baked in is meaningful to the author.
 */
export function groupByLayer(objects: THREE.Object3D[]): Map<string, THREE.Object3D[]> {
	const groups = new Map<string, THREE.Object3D[]>();
	for (const obj of objects) {
		const layer: string = obj.userData?.layer || obj.userData?.category || DEFAULT_LAYER;
		let bucket = groups.get(layer);
		if (!bucket) {
			bucket = [];
			groups.set(layer, bucket);
		}
		bucket.push(obj);
	}
	return groups;
}

/**
 * Filter grouped layers by a free-text query.
 *
 * A layer whose *name* matches keeps all its objects — searching for a layer means wanting to see
 * what's on it. Otherwise the layer keeps only the objects whose labels match, and drops out
 * entirely when none do. An empty query returns the input untouched.
 */
export function filterLayerGroups(
	groups: Map<string, THREE.Object3D[]>,
	query: string
): Map<string, THREE.Object3D[]> {
	if (!query.trim()) return groups;
	const q = query.toLowerCase();
	const filtered = new Map<string, THREE.Object3D[]>();
	for (const [layerName, objects] of groups) {
		const matching = layerName.toLowerCase().includes(q)
			? objects
			: objects.filter((obj) => getObjectLabel(obj).toLowerCase().includes(q));
		if (matching.length > 0) filtered.set(layerName, matching);
	}
	return filtered;
}
