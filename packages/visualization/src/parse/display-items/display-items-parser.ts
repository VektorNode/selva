import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import { buildCurveLine } from './items/curves.js';
import { buildPoint } from './items/points.js';

import type { DisplayItem } from './types';

/**
 * Builds THREE objects for the batch's non-mesh items.
 *
 * @throws VisualizationError when a curve predates backend tessellation, so a stale definition
 * surfaces as an actionable error instead of a scene quietly missing its curves. Every other
 * unrenderable item is logged and skipped.
 */
export function parseDisplayItems(items: DisplayItem[] | undefined): THREE.Object3D[] {
	if (!items || items.length === 0) return [];

	const objects: THREE.Object3D[] = [];

	for (const item of items) {
		switch (item.kind) {
			case 'curve': {
				const line = buildCurveLine(item);
				if (line) objects.push(line);
				break;
			}
			case 'point': {
				const point = buildPoint(item);
				if (point) objects.push(point);
				break;
			}
			default: {
				// Forces a compile error if a new DisplayItem kind is added without a case above.
				const unhandled: never = item;
				const unknown = unhandled as { kind?: string };
				getLogger().warn(`Skipping unknown display item kind: ${String(unknown.kind)}`);
				break;
			}
		}
	}

	return objects;
}
