import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';

import { splitCreases } from '../crease-normals';

/** Welded, as the writer sends it: one vertex per position, shared across every face. */
function welded(geometry: THREE.BufferGeometry) {
	geometry.deleteAttribute('normal');
	geometry.deleteAttribute('uv');
	const merged = mergeVertices(geometry);
	return {
		positions: new Float32Array(merged.getAttribute('position').array),
		indices: new Uint32Array(merged.getIndex()!.array)
	};
}

describe('splitCreases', () => {
	it('gives a welded box flat faces', () => {
		const { positions, indices } = welded(new THREE.BoxGeometry(1, 1, 1));
		expect(positions.length / 3).toBe(8);

		const result = splitCreases(positions, indices, null, null);

		expect(result.indices.length).toBe(36);
		expect(result.positions.length / 3).toBe(24); // each corner split three ways
		// Every corner's normal equals its face's normal: no smear across the 90° folds.
		for (let t = 0; t < 12; t++) {
			const corner = (k: number) =>
				new THREE.Vector3().fromArray(result.positions, result.indices[t * 3 + k]! * 3);
			const face = new THREE.Triangle(corner(0), corner(1), corner(2)).getNormal(
				new THREE.Vector3()
			);
			for (let k = 0; k < 3; k++) {
				const normal = new THREE.Vector3().fromArray(
					result.normals,
					result.indices[t * 3 + k]! * 3
				);
				expect(normal.dot(face)).toBeCloseTo(1, 5);
			}
		}
	});

	it('keeps a finely tessellated sphere smooth', () => {
		const { positions, indices } = welded(new THREE.SphereGeometry(1, 32, 24));

		const result = splitCreases(positions, indices, null, null);

		expect(result.positions.length).toBe(positions.length);
		for (let v = 0; v < result.positions.length / 3; v++) {
			const p = new THREE.Vector3().fromArray(result.positions, v * 3).normalize();
			const n = new THREE.Vector3().fromArray(result.normals, v * 3);
			expect(n.dot(p)).toBeGreaterThan(0.99);
		}
	});

	it('copies uvs and colours onto split vertices', () => {
		const { positions, indices } = welded(new THREE.BoxGeometry(1, 1, 1));
		const vertexCount = positions.length / 3;
		const uvs = new Float32Array(vertexCount * 2).map((_, i) => i);
		const colors = new Uint8Array(vertexCount * 3).map((_, i) => i);

		const result = splitCreases(positions, indices.slice(), uvs, colors);

		for (let corner = 0; corner < 36; corner++) {
			const source = indices[corner]!;
			const target = result.indices[corner]!;
			expect(result.uvs![target * 2]).toBe(uvs[source * 2]);
			expect(result.colors![target * 3 + 2]).toBe(colors[source * 3 + 2]);
		}
	});
});
