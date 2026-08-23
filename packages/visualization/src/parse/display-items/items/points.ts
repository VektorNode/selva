import * as THREE from 'three';

import { getLogger } from '../../../shared/index.js';
import { materialParams } from './appearance.js';

import type { DisplayPoint } from '../types';

export function buildPoint(item: DisplayPoint): THREE.Points | null {
	// `position` comes off the wire — don't trust the declared type without validating.
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

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute([position.X, position.Y, position.Z], 3)
	);

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
