import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { boxField } from '@tests/helpers/bench-geometry';

import { edgeExtractWorkerSource, extractEdgeSegments } from '../edge-extract';

// ============================================================================
// Helpers
// ============================================================================

function extractViaThree(geometry: THREE.BufferGeometry, angle: number): Float32Array {
	const edges = new THREE.EdgesGeometry(geometry, angle);
	const positions = edges.attributes.position
		? (edges.attributes.position.array as Float32Array)
		: new Float32Array(0);
	edges.dispose();
	return positions;
}

function extractViaOurs(geometry: THREE.BufferGeometry, angle: number): Float32Array {
	const positions = geometry.attributes.position.array as Float32Array;
	const index = geometry.index ? (geometry.index.array as Uint32Array | Uint16Array) : null;
	return extractEdgeSegments(positions, index, angle);
}

/**
 * Canonicalize a segment soup for set comparison: order endpoints within each segment
 * lexicographically, then sort the segment list. Both implementations copy the exact same
 * float32 source values into their output, so comparison is exact — only ordering differs.
 */
function canonicalSegments(flat: Float32Array): string[] {
	const segments: string[] = [];
	for (let i = 0; i < flat.length; i += 6) {
		const p0 = [flat[i], flat[i + 1], flat[i + 2]];
		const p1 = [flat[i + 3], flat[i + 4], flat[i + 5]];
		const k0 = p0.join(',');
		const k1 = p1.join(',');
		segments.push(k0 <= k1 ? `${k0}|${k1}` : `${k1}|${k0}`);
	}
	return segments.sort();
}

function expectEquivalent(geometry: THREE.BufferGeometry, angle: number): void {
	expect(canonicalSegments(extractViaOurs(geometry, angle))).toEqual(
		canonicalSegments(extractViaThree(geometry, angle))
	);
}

// ============================================================================
// Equivalence with THREE.EdgesGeometry
// ============================================================================

describe('extractEdgeSegments equivalence with THREE.EdgesGeometry', () => {
	const angles = [1, 44, 89];

	it.each(angles)('box @%s°', (angle) => {
		expectEquivalent(new THREE.BoxGeometry(1, 2, 3), angle);
	});

	it.each(angles)('sphere @%s°', (angle) => {
		expectEquivalent(new THREE.SphereGeometry(2, 12, 8), angle);
	});

	it.each(angles)('plane grid @%s°', (angle) => {
		expectEquivalent(new THREE.PlaneGeometry(4, 4, 5, 5), angle);
	});

	it.each(angles)('torus knot @%s°', (angle) => {
		expectEquivalent(new THREE.TorusKnotGeometry(2, 0.5, 32, 8), angle);
	});

	it.each(angles)('cylinder (mixed smooth + crease) @%s°', (angle) => {
		expectEquivalent(new THREE.CylinderGeometry(1, 1, 2, 16), angle);
	});

	it.each(angles)('non-indexed soup @%s°', (angle) => {
		expectEquivalent(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), angle);
	});

	it('box field fixture @44°', () => {
		expectEquivalent(boxField(1200), 44);
	});

	it('open surface keeps boundary edges regardless of angle', () => {
		const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
		expectEquivalent(plane, 80);
		// Sanity beyond pure equivalence: a 1×1 plane grid has exactly 4 boundary edges.
		expect(extractViaOurs(plane, 80).length).toBe(4 * 6);
	});

	it('degenerate triangles (repeated + collinear vertices) match', () => {
		// Triangle 0: two vertices weld to the same grid point (degenerate — skipped).
		// Triangle 1: collinear (zero-length normal) sharing an edge with triangle 2.
		// Triangle 2: a regular triangle.
		// prettier-ignore
		const positions = new Float32Array([
			0, 0, 0,   0.000004, 0, 0,   1, 1, 0, // welds: 0.000004 rounds to 0 at 1e-4
			0, 0, 0,   1, 0, 0,          2, 0, 0, // collinear
			1, 0, 0,   0, 0, 0,          0.5, 1, 0
		]);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		expectEquivalent(geometry, 44);
		expectEquivalent(geometry, 1);
	});

	it('an edge shared by three faces reproduces the re-registration quirk', () => {
		// Faces 1+2 share edge (0,0,0)-(1,0,0) with opposite winding; face 3 reuses it with the
		// same winding as face 2 — EdgesGeometry re-registers it as pending, so it comes out as
		// a boundary edge. The extractor must mirror that, not "fix" it.
		// prettier-ignore
		const positions = new Float32Array([
			0, 0, 0,   1, 0, 0,   0.5, 1, 0,
			1, 0, 0,   0, 0, 0,   0.5, -1, 0,
			1, 0, 0,   0, 0, 0,   0.5, 0, 1
		]);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		expectEquivalent(geometry, 44);
	});

	it('uint16-indexed geometry works', () => {
		const box = new THREE.BoxGeometry(1, 1, 1);
		expect(box.index!.array).toBeInstanceOf(Uint16Array);
		expectEquivalent(box, 44);
	});
});

// ============================================================================
// Worker source
// ============================================================================

describe('edgeExtractWorkerSource', () => {
	it('stringifies to standalone code with no outer references', () => {
		const source = edgeExtractWorkerSource();
		// Evaluate the worker script against a stub `self` — throws on any stray capture.
		const messages: unknown[] = [];
		const self = {
			onmessage: null as ((event: { data: unknown }) => void) | null,
			postMessage: (message: unknown) => {
				messages.push(message);
			}
		};
		new Function('self', source)(self);
		expect(self.onmessage).toBeTypeOf('function');

		const box = new THREE.BoxGeometry(1, 1, 1);
		self.onmessage!({
			data: {
				id: 7,
				positions: box.attributes.position.array as Float32Array,
				index: box.index!.array as Uint16Array,
				thresholdAngle: 44
			}
		});

		expect(messages).toHaveLength(1);
		const reply = messages[0] as { id: number; segments?: Float32Array; error?: string };
		expect(reply.id).toBe(7);
		expect(reply.error).toBeUndefined();
		expect(canonicalSegments(reply.segments!)).toEqual(canonicalSegments(extractViaThree(box, 44)));
	});

	it('reports extraction errors back instead of throwing', () => {
		const source = edgeExtractWorkerSource();
		const messages: unknown[] = [];
		const self = {
			onmessage: null as ((event: { data: unknown }) => void) | null,
			postMessage: (message: unknown) => {
				messages.push(message);
			}
		};
		new Function('self', source)(self);

		// Malformed payload: positions is not a typed array.
		self.onmessage!({ data: { id: 1, positions: null, index: null, thresholdAngle: 44 } });
		const reply = messages[0] as { id: number; error?: string };
		expect(reply.id).toBe(1);
		expect(reply.error).toBeTypeOf('string');
	});
});
