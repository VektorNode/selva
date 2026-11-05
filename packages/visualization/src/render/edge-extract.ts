/**
 * Dependency-free crease/boundary edge extraction — the hot core behind `addEdges`. Semantically
 * a drop-in for `THREE.EdgesGeometry(geometry, angle)` (same welding, crease test, boundary
 * handling, 3+-face quirks), but operates on raw typed arrays with numeric hashing instead of
 * three's per-vertex string keys, for speed and Worker portability — see the no-outer-captures
 * constraint on {@link extractEdgeSegments} itself.
 */

/** Largest vertex count the fast path takes; callers fall back to `THREE.EdgesGeometry` above it. */
export const MAX_EXTRACT_VERTICES = 0x4000000; // 2^26

/**
 * @param index - Triangle indices, or null for non-indexed soup.
 * @returns `segments`: endpoint pairs, same layout as `EdgesGeometry.attributes.position.array`.
 *   `faces`: per segment, the triangle it came from, so a merged mesh can drop a hidden member's
 *   edges without extracting again.
 * @throws If `positions` holds ≥ 2^26 vertices ({@link MAX_EXTRACT_VERTICES}) — callers fall
 *   back to `THREE.EdgesGeometry`.
 */
export function extractEdgeSegments(
	positions: Float32Array,
	index: Uint32Array | Uint16Array | null,
	thresholdAngleDeg: number
): { segments: Float32Array; faces: Uint32Array } {
	// No outer captures besides Math — this function is stringified via toString() to run inside
	// a Worker ({@link edgeExtractWorkerSource}). Don't reference anything outside this body.
	const PRECISION = 1e4; // same quantization grid as THREE.EdgesGeometry
	const ID_BITS = 0x4000000; // MAX_EXTRACT_VERTICES, restated: this body may not capture it
	const thresholdDot = Math.cos((Math.PI / 180) * thresholdAngleDeg);

	const vertexCount = positions.length / 3;
	if (vertexCount >= ID_BITS) {
		throw new Error(`extractEdgeSegments: ${vertexCount} vertices exceeds 2^26 limit`);
	}

	// --- Weld vertices on the quantization grid → canonical id per vertex -------------------
	// Rounded coords stay float64 (huge coordinates stay exact where int32 would overflow); only
	// the hash truncates to int32 — equality always compares the exact float64 values.
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
	let out = new Float32Array(6 * 1024);
	let outLength = 0;
	let outFaces = new Uint32Array(1024);
	const emit = (i0: number, i1: number, face: number): void => {
		if (outLength + 6 > out.length) {
			const grown = new Float32Array(out.length * 2);
			grown.set(out);
			out = grown;
			const grownFaces = new Uint32Array(out.length / 6);
			grownFaces.set(outFaces);
			outFaces = grownFaces;
		}
		outFaces[outLength / 6] = face;
		out[outLength++] = positions[3 * i0];
		out[outLength++] = positions[3 * i0 + 1];
		out[outLength++] = positions[3 * i0 + 2];
		out[outLength++] = positions[3 * i1];
		out[outLength++] = positions[3 * i1 + 1];
		out[outLength++] = positions[3 * i1 + 2];
	};

	// --- Directed edges grouped by their canonical start vertex (CSR) -----------------------
	// Each row holds one cell per directed-edge occurrence leaving that vertex (about six), so a
	// lookup scans a handful of ints. A Map keyed per directed edge cost ~12M entries on a 4M-tri
	// mesh and dominated extraction (6.5 s against 0.4 s).
	const triCount = (index ? index.length : vertexCount) / 3;
	const rowStart = new Int32Array(vertexCount + 1);
	for (let t = 0; t < triCount; t++) {
		const a = canonical[index ? index[3 * t] : 3 * t];
		const b = canonical[index ? index[3 * t + 1] : 3 * t + 1];
		const c = canonical[index ? index[3 * t + 2] : 3 * t + 2];
		if (a === b || b === c || c === a) continue;
		rowStart[a + 1]++;
		rowStart[b + 1]++;
		rowStart[c + 1]++;
	}
	for (let v = 0; v < vertexCount; v++) rowStart[v + 1] += rowStart[v];
	const cellTo = new Int32Array(rowStart[vertexCount]);
	{
		const cursor = rowStart.slice(0, vertexCount);
		for (let t = 0; t < triCount; t++) {
			const a = canonical[index ? index[3 * t] : 3 * t];
			const b = canonical[index ? index[3 * t + 1] : 3 * t + 1];
			const c = canonical[index ? index[3 * t + 2] : 3 * t + 2];
			if (a === b || b === c || c === a) continue;
			cellTo[cursor[a]++] = b;
			cellTo[cursor[b]++] = c;
			cellTo[cursor[c]++] = a;
		}
	}
	// A directed edge's state lives in the first cell of its row that names its end vertex:
	// UNSEEN, MATCHED, or the pending slot it registered.
	const UNSEEN = -2;
	const MATCHED = -1;
	const cellState = new Int32Array(cellTo.length).fill(UNSEEN);
	const findCell = (from: number, to: number): number => {
		for (let k = rowStart[from], end = rowStart[from + 1]; k < end; k++) {
			if (cellTo[k] === to) return k;
		}
		return -1;
	};

	const cornerOf = (t: number, k: number): number => (index ? index[3 * t + k] : 3 * t + k);

	// Face normal, computed exactly as Triangle.getNormal: normalize((c-b) × (a-b)). Pending edges
	// store only their corner and recompute this on a match: identical values, and 8 bytes per entry
	// instead of 40, which was ~480 MB at 8M triangles.
	const normal = new Float64Array(3);
	const faceNormal = (t: number): void => {
		const i0 = cornerOf(t, 0);
		const i1 = cornerOf(t, 1);
		const i2 = cornerOf(t, 2);
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
		normal[0] = nx;
		normal[1] = ny;
		normal[2] = nz;
	};

	// A pending edge is the corner it starts at (3t + j; it runs to corner j+1 of face t) and the
	// cell holding its state. Most edges pair up, so about half the cells ever register; sized to
	// the mesh because a fixed start dominated small meshes, which come thousands to a batch.
	let pendingCount = 0;
	let pendingCorners = new Uint32Array(Math.max(16, cellTo.length >> 1));
	let pendingCells = new Int32Array(pendingCorners.length);
	const growPending = (): void => {
		const corners = new Uint32Array(pendingCorners.length * 2);
		corners.set(pendingCorners);
		pendingCorners = corners;
		const cells = new Int32Array(corners.length);
		cells.set(pendingCells);
		pendingCells = cells;
	};

	// --- Walk triangles, pairing opposite-winding edges -------------------------------------
	// Mirrors EdgesGeometry: a directed edge a→b matches a pending b→a; on match the segment is
	// kept iff the face normals differ beyond the threshold, and the pending entry is marked
	// MATCHED (never re-registered as a→b) so a third face b→a registers anew. Pending entries
	// left at the end are boundary edges and always emitted.
	for (let t = 0; t < triCount; t++) {
		const i0 = cornerOf(t, 0);
		const i1 = cornerOf(t, 1);
		const i2 = cornerOf(t, 2);
		const a = canonical[i0];
		const b = canonical[i1];
		const c = canonical[i2];

		// Degenerate on the quantization grid — skip, as EdgesGeometry does.
		if (a === b || b === c || c === a) continue;

		let haveNormal = false;
		let nx = 0;
		let ny = 0;
		let nz = 0;
		for (let j = 0; j < 3; j++) {
			const fromCanonical = j === 0 ? a : j === 1 ? b : c;
			const toCanonical = j === 0 ? b : j === 1 ? c : a;

			const reverseCell = findCell(toCanonical, fromCanonical);
			const reverseSlot = reverseCell === -1 ? UNSEEN : cellState[reverseCell];
			if (reverseSlot >= 0) {
				if (!haveNormal) {
					faceNormal(t);
					nx = normal[0];
					ny = normal[1];
					nz = normal[2];
					haveNormal = true;
				}
				faceNormal(Math.floor(pendingCorners[reverseSlot] / 3));
				const dot = nx * normal[0] + ny * normal[1] + nz * normal[2];
				if (dot <= thresholdDot) {
					emit(j === 0 ? i0 : j === 1 ? i1 : i2, j === 0 ? i1 : j === 1 ? i2 : i0, t);
				}
				cellState[reverseCell] = MATCHED;
			} else {
				const forwardCell = findCell(fromCanonical, toCanonical);
				if (cellState[forwardCell] === UNSEEN) {
					if (pendingCount === pendingCorners.length) growPending();
					const slot = pendingCount++;
					cellState[forwardCell] = slot;
					pendingCorners[slot] = 3 * t + j;
					pendingCells[slot] = forwardCell;
				}
			}
		}
	}

	// --- Unmatched edges are boundaries — always kept, in registration order ----------------
	for (let slot = 0; slot < pendingCount; slot++) {
		if (cellState[pendingCells[slot]] !== slot) continue;
		const corner = pendingCorners[slot];
		const t = Math.floor(corner / 3);
		const j = corner - 3 * t;
		emit(cornerOf(t, j), cornerOf(t, j === 2 ? 0 : j + 1), t);
	}

	return { segments: out.slice(0, outLength), faces: outFaces.slice(0, outLength / 6) };
}

/**
 * Worker source running {@link extractEdgeSegments} off the main thread. Protocol: receives
 * `{id, positions, index, thresholdAngle}`, replies `{id, segments, faces}` (buffers transferred) or
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
		`    const { segments, faces } = extract(positions, index, thresholdAngle);`,
		`    self.postMessage({ id, segments, faces }, [segments.buffer, faces.buffer]);`,
		`  } catch (error) {`,
		`    self.postMessage({ id, error: String((error && error.message) || error) });`,
		`  }`,
		`};`
	].join('\n');
}
