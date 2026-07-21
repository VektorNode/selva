import * as THREE from 'three';

/**
 * Deterministic geometry generators for performance benchmarks, sized by target triangle count.
 * Three shapes spanning the edge-extraction spectrum:
 *
 * - {@link planarGrid} — flat tessellation: every interior edge is coplanar, so only the four
 *   boundary edges survive a crease filter. Best case for surviving-segment count.
 * - {@link smoothSphere} — dense smooth curvature: adjacent faces differ by tiny angles, so
 *   (almost) nothing survives a 44° threshold. The "organic mesh" case: full extraction cost
 *   paid, near-zero output.
 * - {@link boxField} — a grid of discrete boxes: 12 sharp creases each, all of which survive.
 *   Worst case for surviving-segment count; the "CAD assembly" case.
 *
 * All are indexed; call `.toNonIndexed()` on a result to exercise vertex-welding paths.
 */

export function planarGrid(targetTriangles: number): THREE.BufferGeometry {
	const segments = Math.max(1, Math.round(Math.sqrt(targetTriangles / 2)));
	return new THREE.PlaneGeometry(10, 10, segments, segments);
}

export function smoothSphere(targetTriangles: number): THREE.BufferGeometry {
	// SphereGeometry yields ~2·width·height triangles; keep width = 2·height for even tessellation.
	const heightSegments = Math.max(2, Math.round(Math.sqrt(targetTriangles / 4)));
	return new THREE.SphereGeometry(5, heightSegments * 2, heightSegments);
}

export function boxField(targetTriangles: number): THREE.BufferGeometry {
	const boxCount = Math.max(1, Math.round(targetTriangles / 12));
	const template = new THREE.BoxGeometry(1, 1, 1);
	const templatePositions = template.attributes.position.array as Float32Array; // 24 verts
	const templateIndex = template.index!.array; // 36 indices

	const positions = new Float32Array(boxCount * templatePositions.length);
	const indices = new Uint32Array(boxCount * templateIndex.length);
	const columns = Math.ceil(Math.sqrt(boxCount));

	for (let b = 0; b < boxCount; b++) {
		const offsetX = (b % columns) * 2;
		const offsetY = Math.floor(b / columns) * 2;
		const positionBase = b * templatePositions.length;
		for (let v = 0; v < templatePositions.length; v += 3) {
			positions[positionBase + v] = templatePositions[v] + offsetX;
			positions[positionBase + v + 1] = templatePositions[v + 1] + offsetY;
			positions[positionBase + v + 2] = templatePositions[v + 2];
		}
		const indexBase = b * templateIndex.length;
		const vertexBase = b * 24;
		for (let i = 0; i < templateIndex.length; i++) {
			indices[indexBase + i] = templateIndex[i] + vertexBase;
		}
	}
	template.dispose();

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
	return geometry;
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
	return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}
