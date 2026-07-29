import * as THREE from 'three';

import { getLogger } from '@selvajs/compute';

import { buildCurveLine } from './items/curves.js';
import { buildPoint } from './items/points.js';

import type { DisplayItem } from './types';
import type { RhinoModule } from 'rhino3dm';

/**
 * Builds THREE.js objects from the non-mesh display items on a DisplayBatch — curves (decoded from
 * Rhino-native JSON via rhino3dm and tessellated to a fat `Line2`) and points (raw positions
 * rendered as one {@link THREE.Points}). Mirrors the mesh path's coordinate handling: every position
 * goes through {@link rhinoToThree}, which is the identity — the Three scene IS Rhino's Z-up frame,
 * so items land at their Rhino coordinates, same as meshes (see `../coordinate-transform.ts`).
 *
 * selva-compute does not own the rhino3dm WASM instance (it is heavy and the host app initializes
 * it once); the caller threads it in, same as the response decoder. If no instance is supplied,
 * curves are skipped with a warning and points still render — they need no decode.
 */

export interface DisplayItemParseOptions {
	/** rhino3dm instance for decoding curve JSON. Omit to skip curves (points still render). */
	rhino?: RhinoModule;
	/**
	 * No-op. Historically toggled the Rhino Z-up → Three Y-up rotation, but the pipeline now keeps
	 * one coordinate frame end to end ({@link rhinoToThree} is the identity), so this flag no longer
	 * changes the result. Do NOT pre-rotate your own geometry to compensate — none is applied.
	 *
	 * @deprecated Retained only so existing call sites compile unchanged; has no effect.
	 */
	applyTransforms?: boolean;
}

/**
 * Parse a batch's `items` into renderable THREE objects. Returns an empty array when there are no
 * items. Unknown kinds are skipped with a warning (forward-compatible with future label/icon kinds
 * a viewer hasn't taught itself to render yet).
 */
export function parseDisplayItems(
	items: DisplayItem[] | undefined,
	options: DisplayItemParseOptions = {}
): THREE.Object3D[] {
	if (!items || items.length === 0) return [];

	const { rhino, applyTransforms = true } = options;
	const objects: THREE.Object3D[] = [];

	for (const item of items) {
		switch (item.kind) {
			case 'curve': {
				const line = buildCurveLine(item, rhino, applyTransforms);
				if (line) objects.push(line);
				break;
			}
			case 'point': {
				const point = buildPoint(item, applyTransforms);
				if (point) objects.push(point);
				break;
			}
			default: {
				// Exhaustiveness guard: assigning to `never` makes a new kind added to the union
				// without a case here a compile error. At runtime (plain-JS callers, newer
				// producers) an unrecognized kind still reaches this branch and is skipped.
				const unhandled: never = item;
				const unknown = unhandled as { kind?: string };
				getLogger().warn(`Skipping unknown display item kind: ${String(unknown.kind)}`);
				break;
			}
		}
	}

	return objects;
}

/** Default fat-line thickness (CSS px) when a curve carries no explicit {@link DisplayCurve.width}. */
