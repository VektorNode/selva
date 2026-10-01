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

	const memberIsClosed = (start: number, count: number): boolean => {
		// A tetrahedron is the smallest closed surface.
		if (count < 12 || count % 3 !== 0) return false;

		// --- Weld: map each corner to the first vertex at (nearly) its position ------------------
		// Rhino meshes each Brep face on its own and stores float32 vertices, so the two copies of a
		// seam point can round one or two float32 steps apart. Snap to a grid two steps wide at the
		// part's largest coordinate: wide enough for that, far below its real features (sliver
		// triangles along a fillet run down to ~1 µm, which a wider weld collapses).
		let magnitude = 0;
		for (let i = 0; i < count; i++) {
			const v = indices[start + i]! * 3;
			magnitude = Math.max(
				magnitude,
				Math.abs(positions[v]!),
				Math.abs(positions[v + 1]!),
				Math.abs(positions[v + 2]!)
			);
		}
		if (!(magnitude > 0) || !Number.isFinite(magnitude)) return false;
		const step = 2 * Math.pow(2, Math.floor(Math.log2(magnitude)) - 23);
		const inverseCell = 1 / step;

		const weldSize = tableSizeFor(count);
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
		for (let i = 0; i < count; i++) {
			const v = indices[start + i]!;
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
				weldVertex[h] = v;
				cellX[h] = x;
				cellY[h] = y;
				cellZ[h] = z;
				canonical = v;
			}
			welded[i] = canonical;
		}

		// --- Directed edges: each must occur once, and its reverse once -------------------------
		// That is exactly "every edge joins two triangles that agree on winding", i.e. closed and
		// consistently oriented.
		const edgeSize = tableSizeFor(count);
		const edgeMask = edgeSize - 1;
		const edgeFrom = new Int32Array(edgeSize).fill(-1);
		const edgeTo = new Int32Array(edgeSize);
		const slotOf = (a: number, b: number): number => {
			let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77)) & edgeMask;
			while (edgeFrom[h] !== -1 && (edgeFrom[h] !== a || edgeTo[h] !== b)) {
				h = (h + 1) & edgeMask;
			}
			return h;
		};
		const insert = (a: number, b: number): boolean => {
			const h = slotOf(a, b);
			if (edgeFrom[h] !== -1) return false; // second use of one directed edge
			edgeFrom[h] = a;
			edgeTo[h] = b;
			return true;
		};
		const has = (a: number, b: number): boolean => edgeFrom[slotOf(a, b)] !== -1;

		let triangles = 0;
		for (let i = 0; i < count; i += 3) {
			const a = welded[i]!;
			const b = welded[i + 1]!;
			const c = welded[i + 2]!;
			// Collapsed by welding (or authored that way): no area, nothing to see from either side.
			if (a === b || b === c || c === a) continue;
			if (!insert(a, b) || !insert(b, c) || !insert(c, a)) return false;
			triangles++;
		}
		if (triangles < 4) return false;
		for (let i = 0; i < count; i += 3) {
			const a = welded[i]!;
			const b = welded[i + 1]!;
			const c = welded[i + 2]!;
			if (a === b || b === c || c === a) continue;
			if (!has(b, a) || !has(c, b) || !has(a, c)) return false;
		}

		// --- Outward: counter-clockwise winding seen from outside encloses positive volume -------
		const o = welded[0]! * 3;
		const ox = positions[o]!;
		const oy = positions[o + 1]!;
		const oz = positions[o + 2]!;
		let volume = 0;
		for (let i = 0; i < count; i += 3) {
			const a = welded[i]! * 3;
			const b = welded[i + 1]! * 3;
			const c = welded[i + 2]! * 3;
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
	for (const count of memberIndexCounts) {
		if (!memberIsClosed(start, count)) return false;
		start += count;
	}
	return true;
}
