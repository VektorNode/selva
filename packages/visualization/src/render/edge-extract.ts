/**
 * Dependency-free crease/boundary edge extraction — the hot core behind `addEdges`. Semantically
 * a drop-in for `THREE.EdgesGeometry(geometry, angle)` (same welding, crease test, boundary
 * handling, 3+-face quirks), but operates on raw typed arrays with numeric hashing instead of
 * three's per-vertex string keys (~2.9s/1M triangles) for speed and Worker portability.
 *
 * {@link extractEdgeSegments} has zero outer captures (only `Math` + its args), so
 * `Function.prototype.toString` yields code that runs unchanged inside a Worker —
 * {@link edgeExtractWorkerSource} builds that script. Don't import anything into its body; that
 * silently breaks the worker path.
 */

/** Vertex ids pack two-per-double in edge keys; above 2^26 vertices the packing overflows. */
export const MAX_EXTRACT_VERTICES = 0x4000000; // 2^26

/**
 * @param index - Triangle indices, or null for non-indexed soup.
 * @param thresholdAngleDeg - Keep edges whose adjacent face normals differ by more than this.
 * @returns Segment endpoint pairs, same layout as `EdgesGeometry.attributes.position.array`.
 * @throws If `positions` holds ≥ 2^26 vertices ({@link MAX_EXTRACT_VERTICES}) — callers fall
 *   back to `THREE.EdgesGeometry`.
 */
export function extractEdgeSegments(
	positions: Float32Array,
	index: Uint32Array | Uint16Array | null,
	thresholdAngleDeg: number
): Float32Array {
	// Self-contained by design (worker stringification) — no outer references besides Math.
	const PRECISION = 1e4; // same quantization grid as THREE.EdgesGeometry
	const ID_BITS = 0x4000000; // 2^26 — two ids pack into one float64-exact integer key
	const thresholdDot = Math.cos((Math.PI / 180) * thresholdAngleDeg);

	const vertexCount = positions.length / 3;
	if (vertexCount >= ID_BITS) {
		throw new Error(`extractEdgeSegments: ${vertexCount} vertices exceeds 2^26 limit`);
	}

	// --- Weld vertices on the quantization grid → canonical id per vertex -------------------
	// Rounded coords kept as float64 (huge coordinates stay exact where int32 would overflow);
	// the hash only needs int32 truncations — equality always compares the exact values.
	const quantX = new Float64Array(vertexCount);
	const quantY = new Float64Array(vertexCount);
	const quantZ = new Float64Array(vertexCount);
	for (let v = 0; v < vertexCount; v++) {
		quantX[v] = Math.round(positions[3 * v] * PRECISION);
		quantY[v] = Math.round(positions[3 * v + 1] * PRECISION);
		quantZ[v] = Math.round(positions[3 * v + 2] * PRECISION);
	}

	// Open-addressed table (linear probing): slot → first vertex id seen at that grid point.
	let capacity = 16;
	while (capacity < vertexCount * 2) capacity <<= 1;
	const mask = capacity - 1;
	const table = new Int32Array(capacity).fill(-1);
	const canonical = new Int32Array(vertexCount);
	for (let v = 0; v < vertexCount; v++) {
		let slot =
			(Math.imul(quantX[v] | 0, 73856093) ^
				Math.imul(quantY[v] | 0, 19349663) ^
				Math.imul(quantZ[v] | 0, 83492791)) &
			mask;
		for (;;) {
			const existing = table[slot];
			if (existing === -1) {
				table[slot] = v;
				canonical[v] = v;
				break;
			}
			if (
				quantX[existing] === quantX[v] &&
				quantY[existing] === quantY[v] &&
				quantZ[existing] === quantZ[v]
			) {
				canonical[v] = existing;
				break;
			}
			slot = (slot + 1) & mask;
		}
	}

	// --- Growable segment output ------------------------------------------------------------
	let out = new Float32Array(4096);
	let outLength = 0;
	const emit = (i0: number, i1: number): void => {
		if (outLength + 6 > out.length) {
			const grown = new Float32Array(out.length * 2);
			grown.set(out);
			out = grown;
		}
		out[outLength++] = positions[3 * i0];
		out[outLength++] = positions[3 * i0 + 1];
		out[outLength++] = positions[3 * i0 + 2];
		out[outLength++] = positions[3 * i1];
		out[outLength++] = positions[3 * i1 + 1];
		out[outLength++] = positions[3 * i1 + 2];
	};

	// --- Walk triangles, pairing opposite-winding edges -------------------------------------
	// Mirrors EdgesGeometry: a directed edge a→b matches a pending b→a; on match the segment is
	// kept iff the face normals differ beyond the threshold, and the pending entry is tombstoned
	// (key kept, value -1) so a third face on the same edge re-registers it — quirk preserved.
	// Unmatched entries at the end are boundary edges and always emitted.
	const edgeSlots = new Map<number, number>(); // directed key → pending-edge slot, -1 = matched
	const pendingIndex0: number[] = []; // original vertex indices, for boundary emission
	const pendingIndex1: number[] = [];
	const pendingNormals: number[] = []; // xyz per pending edge

	const triCount = (index ? index.length : vertexCount) / 3;
	for (let t = 0; t < triCount; t++) {
		const i0 = index ? index[3 * t] : 3 * t;
		const i1 = index ? index[3 * t + 1] : 3 * t + 1;
		const i2 = index ? index[3 * t + 2] : 3 * t + 2;
		const a = canonical[i0];
		const b = canonical[i1];
		const c = canonical[i2];

		// Degenerate on the quantization grid — skip, as EdgesGeometry does.
		if (a === b || b === c || c === a) continue;

		// Face normal, computed exactly as Triangle.getNormal: normalize((c-b) × (a-b)).
		const e0x = positions[3 * i2] - positions[3 * i1];
		const e0y = positions[3 * i2 + 1] - positions[3 * i1 + 1];
		const e0z = positions[3 * i2 + 2] - positions[3 * i1 + 2];
		const e1x = positions[3 * i0] - positions[3 * i1];
		const e1y = positions[3 * i0 + 1] - positions[3 * i1 + 1];
		const e1z = positions[3 * i0 + 2] - positions[3 * i1 + 2];
		let nx = e0y * e1z - e0z * e1y;
		let ny = e0z * e1x - e0x * e1z;
		let nz = e0x * e1y - e0y * e1x;
		const lengthSq = nx * nx + ny * ny + nz * nz;
		if (lengthSq > 0) {
			const inverseLength = 1 / Math.sqrt(lengthSq);
			nx *= inverseLength;
			ny *= inverseLength;
			nz *= inverseLength;
		} else {
			nx = 0;
			ny = 0;
			nz = 0;
		}

		for (let j = 0; j < 3; j++) {
			let from: number;
			let to: number;
			let fromCanonical: number;
			let toCanonical: number;
			if (j === 0) {
				from = i0;
				to = i1;
				fromCanonical = a;
				toCanonical = b;
			} else if (j === 1) {
				from = i1;
				to = i2;
				fromCanonical = b;
				toCanonical = c;
			} else {
				from = i2;
				to = i0;
				fromCanonical = c;
				toCanonical = a;
			}

			const reverseKey = toCanonical * ID_BITS + fromCanonical;
			const reverseSlot = edgeSlots.get(reverseKey);
			if (reverseSlot !== undefined && reverseSlot !== -1) {
				const dot =
					nx * pendingNormals[3 * reverseSlot] +
					ny * pendingNormals[3 * reverseSlot + 1] +
					nz * pendingNormals[3 * reverseSlot + 2];
				if (dot <= thresholdDot) emit(from, to);
				edgeSlots.set(reverseKey, -1);
			} else {
				const forwardKey = fromCanonical * ID_BITS + toCanonical;
				if (!edgeSlots.has(forwardKey)) {
					const slot = pendingIndex0.length;
					edgeSlots.set(forwardKey, slot);
					pendingIndex0.push(from);
					pendingIndex1.push(to);
					pendingNormals.push(nx, ny, nz);
				}
			}
		}
	}

	// --- Unmatched edges are boundaries — always kept ---------------------------------------
	for (const slot of edgeSlots.values()) {
		if (slot !== -1) emit(pendingIndex0[slot], pendingIndex1[slot]);
	}

	return out.slice(0, outLength);
}

/**
 * Worker source running {@link extractEdgeSegments} off the main thread. Protocol: receives
 * `{id, positions, index, thresholdAngle}`, replies `{id, segments}` (buffer transferred) or
 * `{id, error}`.
 *
 * Relies on `extractEdgeSegments` stringifying to standalone code — guarded by a unit test that
 * evals this source in isolation.
 */
export function edgeExtractWorkerSource(): string {
	return [
		`const extract = ${extractEdgeSegments.toString()};`,
		`self.onmessage = (event) => {`,
		`  const { id, positions, index, thresholdAngle } = event.data;`,
		`  try {`,
		`    const segments = extract(positions, index, thresholdAngle);`,
		`    self.postMessage({ id, segments }, [segments.buffer]);`,
		`  } catch (error) {`,
		`    self.postMessage({ id, error: String((error && error.message) || error) });`,
		`  }`,
		`};`
	].join('\n');
}
