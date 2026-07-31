import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import { buildCurveLine } from './items/curves.js';
import { buildPoint } from './items/points.js';

import type { DisplayItem } from './types';
import type { RhinoModule } from 'rhino3dm';

export interface DisplayItemParseOptions {
	/** Omit to skip curves; points still render. */
	rhino?: RhinoModule;
}

export function parseDisplayItems(
	items: DisplayItem[] | undefined,
	options: DisplayItemParseOptions = {}
): THREE.Object3D[] {
	if (!items || items.length === 0) return [];

	const { rhino } = options;
	const objects: THREE.Object3D[] = [];

	for (const item of items) {
		switch (item.kind) {
			case 'curve': {
				const line = buildCurveLine(item, rhino);
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
