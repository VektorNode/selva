import * as THREE from 'three';

import { getLogger } from '@selvajs/compute';

import { rhinoToThree } from '../../../shared/index.js';
import { materialParams } from './appearance.js';

import type { DisplayPoint } from '../types';

export function buildPoint(item: DisplayPoint, applyTransforms: boolean): THREE.Points | null {
	// Validate before trusting the declared type: `position` comes off the wire.
	const { position } = item as { position?: { X?: unknown; Y?: unknown; Z?: unknown } };
	if (
		!position ||
		typeof position.X !== 'number' ||
		!Number.isFinite(position.X) ||
		typeof position.Y !== 'number' ||
		!Number.isFinite(position.Y) ||
		typeof position.Z !== 'number' ||
		!Number.isFinite(position.Z)
	) {
		getLogger().warn(
			`Skipping point display item with missing or non-finite position (id: ${String(item.id)}).`
		);
		return null;
	}

	const { x, y, z } = rhinoToThree(position.X, position.Y, position.Z, applyTransforms);

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute([x, y, z], 3));

	const material = new THREE.PointsMaterial({
		...materialParams(item.color, item.opacity),
		size: 6,
		sizeAttenuation: false
	});

	const points = new THREE.Points(geometry, material);
	points.name = item.name;
	points.userData = {
		source: 'compute',
		id: item.id,
		layer: item.layer,
		kind: 'point',
		metadata: item.metadata
	};
	return points;
}

/**
 * Free a rhino3dm object's WASM-heap memory. rhino3dm objects are emscripten bindings — JS GC
 * never reclaims their heap allocation, so everything decoded during a solve must be deleted
 * explicitly or the WASM heap grows monotonically across solves.
 */
