export interface CreasedGeometry {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	uvs: Float32Array | null;
	colors: Uint8Array | null;
}

/**
 * Vertex normals that stay smooth across gentle curvature and break at creases, splitting a vertex
 * wherever the faces sharing it disagree by more than the crease angle.
 *
 * The writer welds coincident vertices, and seams between Brep faces often come out welded
 * across a 90° fold. A plain average there tilts every normal along the fold halfway round it,
 * and the long thin triangles of a sheet-metal strip carry that tilt metres across a flat face:
 * streaks, an X around every hole, a whole strip shaded darker than its neighbour.
 *
 * Face normals are area-weighted: across a tangent bend the bend's facets are narrow, so they barely
 * tilt the wide flat face beside them. Weighting by corner angle instead let a bend facet's corner
 * tilt a flat band by up to 23°, enough to flip a metal's reflection from sky to ground.
 *
 * `indices` is rewritten in place to point split corners at their new vertices, which are appended
 * after the existing ones; the index count never changes, so index windows stay valid.
 *
 * Self-contained (no outer captures besides `Math`) so the mesh-assembly worker can embed it via
 * `Function.prototype.toString`.
 */
export function splitCreases(
	positions: Float32Array,
	indices: Uint32Array,
	uvs: Float32Array | null,
	colors: Uint8Array | null
): CreasedGeometry {
	// NOTE: self-contained by design (worker stringification) — no outer references besides Math.
	// Faces further apart than this split their shared vertex. Above a coarse render mesh's step
	// around a fillet (Rhino's defaults stay under 20°), below any real fold.
	const CREASE_COS = Math.cos((30 * Math.PI) / 180);

	const vertexCount = positions.length / 3;
	const cornerCount = indices.length;
	const triangleCount = cornerCount / 3;

	// --- Weld identical vertices first ------------------------------------------------------------
	// Which seams arrive welded is the writer's call, and it isn't consistent: it compares normals
	// at the seam within a tolerance, so two identical strips can come out one welded, one split
	// along the same tangent bend, and then reflect visibly differently. Welding every identical
	// vertex (position, UV and colour alike) here makes the crease angle the only thing that
	// decides. The orphaned duplicates stay in the buffers, unreferenced.
	{
		const posBits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
		const uvBits = uvs ? new Uint32Array(uvs.buffer, uvs.byteOffset, uvs.length) : null;
		// -0 and +0 are one position with two bit patterns.
		const word = (bits: Uint32Array, i: number) => (bits[i] === 0x80000000 ? 0 : bits[i]!);
		const same = (a: number, b: number): boolean => {
			for (let k = 0; k < 3; k++) {
				if (word(posBits, a * 3 + k) !== word(posBits, b * 3 + k)) return false;
				if (colors && colors[a * 3 + k] !== colors[b * 3 + k]) return false;
			}
			if (uvBits) {
				if (uvBits[a * 2] !== uvBits[b * 2] || uvBits[a * 2 + 1] !== uvBits[b * 2 + 1])
					return false;
			}
			return true;
		};
		let size = 16;
		while (size < vertexCount * 2) size *= 2;
		const mask = size - 1;
		const slots = new Int32Array(size).fill(-1);
		const canonical = new Uint32Array(vertexCount);
		for (let v = 0; v < vertexCount; v++) {
			let h =
				Math.imul(word(posBits, v * 3), 0x9e3779b1) ^
				Math.imul(word(posBits, v * 3 + 1), 0x85ebca77) ^
				Math.imul(word(posBits, v * 3 + 2), 0xc2b2ae3d);
			h = (h ^ (h >>> 15)) & mask;
			while (slots[h] !== -1 && !same(slots[h]!, v)) h = (h + 1) & mask;
			if (slots[h] === -1) slots[h] = v;
			canonical[v] = slots[h]!;
		}
		for (let i = 0; i < cornerCount; i++) indices[i] = canonical[indices[i]!]!;
	}

	// --- Unit face normals and areas ---------------------------------------------------------------
	const faceNormals = new Float32Array(triangleCount * 3);
	const faceAreas = new Float32Array(triangleCount);
	for (let t = 0; t < triangleCount; t++) {
		const a = indices[t * 3]! * 3;
		const b = indices[t * 3 + 1]! * 3;
		const c = indices[t * 3 + 2]! * 3;
		const abx = positions[b]! - positions[a]!;
		const aby = positions[b + 1]! - positions[a + 1]!;
		const abz = positions[b + 2]! - positions[a + 2]!;
		const acx = positions[c]! - positions[a]!;
		const acy = positions[c + 1]! - positions[a + 1]!;
		const acz = positions[c + 2]! - positions[a + 2]!;
		const nx = aby * acz - abz * acy;
		const ny = abz * acx - abx * acz;
		const nz = abx * acy - aby * acx;
		const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (length === 0) continue; // degenerate: no normal, no weight
		faceNormals[t * 3] = nx / length;
		faceNormals[t * 3 + 1] = ny / length;
		faceNormals[t * 3 + 2] = nz / length;
		faceAreas[t] = length;
	}

	// --- Corners grouped by vertex (CSR) ----------------------------------------------------------
	const cornerStart = new Uint32Array(vertexCount + 1);
	for (let i = 0; i < cornerCount; i++) cornerStart[indices[i]! + 1] += 1;
	for (let v = 0; v < vertexCount; v++) cornerStart[v + 1] += cornerStart[v]!;
	const cornersOf = new Uint32Array(cornerCount);
	const fill = cornerStart.slice(0, vertexCount);
	for (let i = 0; i < cornerCount; i++) {
		const v = indices[i]!;
		cornersOf[fill[v]!] = i;
		fill[v] += 1;
	}

	// --- Group each vertex's corners by face normal -----------------------------------------------
	// A corner joins the first group whose founding normal is within the crease angle. Degenerate
	// faces (zero normal) join group 0.
	let maxDegree = 0;
	for (let v = 0; v < vertexCount; v++) {
		maxDegree = Math.max(maxDegree, cornerStart[v + 1]! - cornerStart[v]!);
	}
	const groupOf = new Uint32Array(cornerCount);
	const groupCount = new Uint32Array(vertexCount);
	const founders = new Float32Array(Math.max(1, maxDegree) * 3);
	for (let v = 0; v < vertexCount; v++) {
		let groups = 0;
		for (let k = cornerStart[v]!; k < cornerStart[v + 1]!; k++) {
			const corner = cornersOf[k]!;
			const f = Math.floor(corner / 3) * 3;
			const nx = faceNormals[f]!;
			const ny = faceNormals[f + 1]!;
			const nz = faceNormals[f + 2]!;
			let group = -1;
			if (nx === 0 && ny === 0 && nz === 0) {
				group = 0;
			} else {
				for (let g = 0; g < groups; g++) {
					const dot = founders[g * 3]! * nx + founders[g * 3 + 1]! * ny + founders[g * 3 + 2]! * nz;
					if (dot >= CREASE_COS) {
						group = g;
						break;
					}
				}
			}
			if (group === -1) {
				group = groups;
				founders[groups * 3] = nx;
				founders[groups * 3 + 1] = ny;
				founders[groups * 3 + 2] = nz;
				groups++;
			}
			groupOf[corner] = group;
		}
		groupCount[v] = Math.max(1, groups);
	}

	// --- Split: group 0 keeps the vertex, later groups get appended copies ------------------------
	const extraStart = new Uint32Array(vertexCount + 1);
	for (let v = 0; v < vertexCount; v++) extraStart[v + 1] = extraStart[v]! + groupCount[v]! - 1;
	const extra = extraStart[vertexCount]!;
	const total = vertexCount + extra;

	let outPositions = positions;
	let outUvs = uvs;
	let outColors = colors;
	if (extra > 0) {
		outPositions = new Float32Array(total * 3);
		outPositions.set(positions);
		outUvs = uvs ? new Float32Array(total * 2) : null;
		if (outUvs && uvs) outUvs.set(uvs);
		outColors = colors ? new Uint8Array(total * 3) : null;
		if (outColors && colors) outColors.set(colors);
		for (let v = 0; v < vertexCount; v++) {
			for (let g = 1; g < groupCount[v]!; g++) {
				const copy = vertexCount + extraStart[v]! + g - 1;
				outPositions[copy * 3] = positions[v * 3]!;
				outPositions[copy * 3 + 1] = positions[v * 3 + 1]!;
				outPositions[copy * 3 + 2] = positions[v * 3 + 2]!;
				if (outUvs && uvs) {
					outUvs[copy * 2] = uvs[v * 2]!;
					outUvs[copy * 2 + 1] = uvs[v * 2 + 1]!;
				}
				if (outColors && colors) {
					outColors[copy * 3] = colors[v * 3]!;
					outColors[copy * 3 + 1] = colors[v * 3 + 1]!;
					outColors[copy * 3 + 2] = colors[v * 3 + 2]!;
				}
			}
		}
	}

	const normals = new Float32Array(total * 3);
	for (let corner = 0; corner < cornerCount; corner++) {
		const v = indices[corner]!;
		const g = groupOf[corner]!;
		const target = g === 0 ? v : vertexCount + extraStart[v]! + g - 1;
		indices[corner] = target;
		const f = Math.floor(corner / 3) * 3;
		const w = faceAreas[f / 3]!;
		normals[target * 3] += faceNormals[f]! * w;
		normals[target * 3 + 1] += faceNormals[f + 1]! * w;
		normals[target * 3 + 2] += faceNormals[f + 2]! * w;
	}
	for (let i = 0; i < normals.length; i += 3) {
		const x = normals[i]!;
		const y = normals[i + 1]!;
		const z = normals[i + 2]!;
		const length = Math.sqrt(x * x + y * y + z * z) || 1;
		normals[i] = x / length;
		normals[i + 1] = y / length;
		normals[i + 2] = z / length;
	}

	return { positions: outPositions, normals, indices, uvs: outUvs, colors: outColors };
}
