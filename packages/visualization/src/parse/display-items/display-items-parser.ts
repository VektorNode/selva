import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import { buildCurveLine } from './items/curves.js';
import { buildPoint } from './items/points.js';

import type { DisplayItem } from './types';
import type { RhinoModule } from 'rhino3dm';

// rhino3dm WASM is heavy and host-owned (initialized once by the app), so the instance is threaded
// in rather than imported here — same pattern as the response decoder.

export interface DisplayItemParseOptions {
	/** rhino3dm instance for decoding curve JSON. Omit to skip curves (points still render). */
	rhino?: RhinoModule;
	/** @deprecated No-op — {@link rhinoToThree} is the identity now. Do not pre-rotate to compensate. */
	applyTransforms?: boolean;
}

/** Unknown item kinds are skipped with a warning (forward-compat with kinds a viewer can't render yet). */
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
				// `never` assignment: a new DisplayItem kind without a case above fails to compile.
				const unhandled: never = item;
				const unknown = unhandled as { kind?: string };
				getLogger().warn(`Skipping unknown display item kind: ${String(unknown.kind)}`);
				break;
			}
		}
	}

	return objects;
}
