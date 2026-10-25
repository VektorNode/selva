/**
 * True when every member of a geometry is a closed, consistently wound, outward-facing triangle
 * surface, so its back faces can never be seen and the material can cull them.
 *
 * Drawing them anyway is not just overdraw. A thin closed part (a 0.5 mm sheet) puts its inside
 * faces within one depth-buffer step of its outside ones, and once precision drops below the
 * thickness they punch through as dark jagged triangles. Culled, they never compete.
 *
 * Members are tested apart, because two closed parts touching along an edge share it four ways and
 * would read as open together. Positions are welded first: Rhino meshes each Brep face separately,
 * so a solid's seams carry duplicate vertices that only position identifies. Any
 * doubt (an unwelded seam, a non-manifold edge, inward winding) answers false, which keeps the
 * double-sided default.
 *
 * Self-contained (no outer captures besides `Math`) so the mesh-assembly worker can embed it via
 * `Function.prototype.toString`.
 *
 * @param memberIndexCounts Index count of each member, in order; members are concatenated in
 *   `indices`.
 */
export function isClosedSolid(
	positions: Float32Array,
	indices: Uint32Array,
	memberIndexCounts: number[]
): boolean {
	// NOTE: self-contained by design (worker stringification) — no outer references besides Math.
	if (memberIndexCounts.length === 0) return false;

	const tableSizeFor = (count: number): number => {
		let size = 16;
		while (size < count * 2) size *= 2;
		return size;
	};

	// Welding works per vertex, not per corner: a vertex is shared by ~6 corners, and welding each
	// corner on its own could also map one vertex to two different canonicals. Member m tags a
	// vertex 2m+1 once seen and 2m+2 once welded, so `canonicalOf` needs no reset between members.
	// Canonicals are numbered per member (0, 1, …), which keeps the edge arrays member-sized.
	const vertexCount = positions.length / 3;
	const tag = new Int32Array(vertexCount);
	const canonicalOf = new Int32Array(vertexCount);

	const memberIsClosed = (member: number, start: number, count: number): boolean => {
		// A tetrahedron is the smallest closed surface.
		if (count < 12 || count % 3 !== 0) return false;

		const seen = 2 * member + 1;
		const done = seen + 1;

		// --- Weld: map each vertex to the first vertex at (nearly) its position ------------------
		// Rhino meshes each Brep face on its own and stores float32 vertices, so the two copies of a
		// seam point can round one or two float32 steps apart. Snap to a grid two steps wide at the
		// part's largest coordinate: wide enough for that, far below its real features (sliver
		// triangles along a fillet run down to ~1 µm, which a wider weld collapses).
		let magnitude = 0;
		let uniqueVertices = 0;
		for (let i = 0; i < count; i++) {
			const v = indices[start + i]!;
			if (tag[v] === seen) continue;
			tag[v] = seen;
			uniqueVertices++;
			magnitude = Math.max(
				magnitude,
				Math.abs(positions[v * 3]!),
				Math.abs(positions[v * 3 + 1]!),
				Math.abs(positions[v * 3 + 2]!)
			);
		}
		if (!(magnitude > 0) || !Number.isFinite(magnitude)) return false;
		const step = 2 * Math.pow(2, Math.floor(Math.log2(magnitude)) - 23);
		const inverseCell = 1 / step;

		const weldSize = tableSizeFor(uniqueVertices);
		const weldMask = weldSize - 1;
		const weldVertex = new Int32Array(weldSize).fill(-1);
		const cellX = new Int32Array(weldSize);
		const cellY = new Int32Array(weldSize);
		const cellZ = new Int32Array(weldSize);
		const cellSlot = (x: number, y: number, z: number): number => {
			let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d);
			h = (h ^ (h >>> 15)) & weldMask;
			while (weldVertex[h] !== -1 && (cellX[h] !== x || cellY[h] !== y || cellZ[h] !== z)) {
				h = (h + 1) & weldMask;
			}
			return h;
		};
		// The cell across the nearer boundary, for a point close enough to it that its near-copy could
		// have rounded into the other cell.
		const neighbour = (scaled: number, cell: number): number => {
			const offset = scaled - cell;
			return offset > 0.25 ? cell + 1 : offset < -0.25 ? cell - 1 : cell;
		};

		const welded = new Int32Array(count);
		// The vertex each canonical stands for, to read its position.
		const vertexOf = new Int32Array(uniqueVertices);
		let canonicals = 0;
		for (let i = 0; i < count; i++) {
			const v = indices[start + i]!;
			if (tag[v] === done) {
				welded[i] = canonicalOf[v]!;
				continue;
			}
			const sx = positions[v * 3]! * inverseCell;
			const sy = positions[v * 3 + 1]! * inverseCell;
			const sz = positions[v * 3 + 2]! * inverseCell;
			const x = Math.round(sx);
			const y = Math.round(sy);
			const z = Math.round(sz);
			const nx = neighbour(sx, x);
			const ny = neighbour(sy, y);
			const nz = neighbour(sz, z);

			let canonical = -1;
			for (let combo = 0; combo < 8 && canonical === -1; combo++) {
				if ((combo & 1 && nx === x) || (combo & 2 && ny === y) || (combo & 4 && nz === z)) continue;
				const h = cellSlot(combo & 1 ? nx : x, combo & 2 ? ny : y, combo & 4 ? nz : z);
				if (weldVertex[h] !== -1) canonical = weldVertex[h]!;
			}
			if (canonical === -1) {
				const h = cellSlot(x, y, z);
				canonical = canonicals++;
				weldVertex[h] = canonical;
				cellX[h] = x;
				cellY[h] = y;
				cellZ[h] = z;
				vertexOf[canonical] = v;
			}
			tag[v] = done;
			canonicalOf[v] = canonical;
			welded[i] = canonical;
		}

		// --- Directed edges: each must occur once, and its reverse once -------------------------
		// That is exactly "every edge joins two triangles that agree on winding", i.e. closed and
		// consistently oriented. Each canonical's outgoing edges sit together, so both checks scan
		// its handful of neighbours rather than hashing every edge.
		const outStart = new Int32Array(canonicals + 1);
		let triangles = 0;
		for (let i = 0; i < count; i += 3) {
			const a = welded[i]!;
			const b = welded[i + 1]!;
			const c = welded[i + 2]!;
			// Collapsed by welding (or authored that way): no area, nothing to see from either side.
			if (a === b || b === c || c === a) continue;
			outStart[a + 1] += 1;
			outStart[b + 1] += 1;
			outStart[c + 1] += 1;
			triangles++;
		}
		if (triangles < 4) return false;
		for (let k = 0; k < canonicals; k++) outStart[k + 1] += outStart[k]!;
		const outTo = new Int32Array(outStart[canonicals]!);
		const cursor = outStart.slice(0, canonicals);
		for (let i = 0; i < count; i += 3) {
			const a = welded[i]!;
			const b = welded[i + 1]!;
			const c = welded[i + 2]!;
			if (a === b || b === c || c === a) continue;
			outTo[cursor[a]!] = b;
			cursor[a] += 1;
			outTo[cursor[b]!] = c;
			cursor[b] += 1;
			outTo[cursor[c]!] = a;
			cursor[c] += 1;
		}
		for (let a = 0; a < canonicals; a++) {
			const first = outStart[a]!;
			const end = outStart[a + 1]!;
			for (let k = first; k < end; k++) {
				const b = outTo[k]!;
				for (let j = first; j < k; j++) {
					if (outTo[j] === b) return false; // second use of one directed edge
				}
				let reversed = false;
				for (let j = outStart[b]!, bEnd = outStart[b + 1]!; j < bEnd && !reversed; j++) {
					reversed = outTo[j] === a;
				}
				if (!reversed) return false;
			}
		}

		// --- Outward: counter-clockwise winding seen from outside encloses positive volume -------
		const o = vertexOf[welded[0]!]! * 3;
		const ox = positions[o]!;
		const oy = positions[o + 1]!;
		const oz = positions[o + 2]!;
		let volume = 0;
		for (let i = 0; i < count; i += 3) {
			const a = vertexOf[welded[i]!]! * 3;
			const b = vertexOf[welded[i + 1]!]! * 3;
			const c = vertexOf[welded[i + 2]!]! * 3;
			const ax = positions[a]! - ox;
			const ay = positions[a + 1]! - oy;
			const az = positions[a + 2]! - oz;
			const bx = positions[b]! - ox;
			const by = positions[b + 1]! - oy;
			const bz = positions[b + 2]! - oz;
			const cx = positions[c]! - ox;
			const cy = positions[c + 1]! - oy;
			const cz = positions[c + 2]! - oz;
			volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
		}
		return volume > 0;
	};

	let start = 0;
	for (let member = 0; member < memberIndexCounts.length; member++) {
		const count = memberIndexCounts[member]!;
		if (!memberIsClosed(member, start, count)) return false;
		start += count;
	}
	return true;
}
