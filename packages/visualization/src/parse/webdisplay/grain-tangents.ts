/**
 * Per-vertex tangents for three's `tangent` attribute: xyz along increasing U, w the handedness that
 * points `cross(normal, tangent)` along increasing V.
 *
 * Without the attribute three rebuilds the frame per pixel from screen-space UV derivatives, which
 * is noisy on long thin triangles. three's own `computeTangents()` needs V to vary on every
 * triangle and leaves a zero tangent where it doesn't (a tube centred on its grain axis has constant
 * V), and a zero tangent renders NaN-black. Only U's gradient is needed here, so V can be anything.
 *
 * Self-contained (no outer captures besides `Math`) so the mesh-assembly worker can embed it via
 * `Function.prototype.toString`.
 */
export function grainTangents(
	positions: Float32Array,
	normals: Float32Array,
	indices: Uint32Array,
	uvs: Float32Array
): Float32Array {
	// NOTE: self-contained by design (worker stringification) — no outer references besides Math.
	const vertexCount = positions.length / 3;
	const gradU = new Float32Array(vertexCount * 3);
	const gradV = new Float32Array(vertexCount * 3);

	// Area-weighted gradients of U and V over each triangle. With e1, e2 the edges from corner a and
	// n = e1 × e2, a linear f has ∇f = (df1 (e2 × n) + df2 (n × e1)) / |n|²; times the area |n| / 2.
	for (let t = 0; t < indices.length; t += 3) {
		const a = indices[t]!;
		const b = indices[t + 1]!;
		const c = indices[t + 2]!;
		const e1x = positions[b * 3]! - positions[a * 3]!;
		const e1y = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
		const e1z = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
		const e2x = positions[c * 3]! - positions[a * 3]!;
		const e2y = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
		const e2z = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (length === 0) continue;
		// e2 × n and n × e1, pre-divided by |n| for the area weighting.
		const px = (e2y * nz - e2z * ny) / length;
		const py = (e2z * nx - e2x * nz) / length;
		const pz = (e2x * ny - e2y * nx) / length;
		const qx = (ny * e1z - nz * e1y) / length;
		const qy = (nz * e1x - nx * e1z) / length;
		const qz = (nx * e1y - ny * e1x) / length;
		const du1 = uvs[b * 2]! - uvs[a * 2]!;
		const du2 = uvs[c * 2]! - uvs[a * 2]!;
		const dv1 = uvs[b * 2 + 1]! - uvs[a * 2 + 1]!;
		const dv2 = uvs[c * 2 + 1]! - uvs[a * 2 + 1]!;
		const ux = du1 * px + du2 * qx;
		const uy = du1 * py + du2 * qy;
		const uz = du1 * pz + du2 * qz;
		const vx = dv1 * px + dv2 * qx;
		const vy = dv1 * py + dv2 * qy;
		const vz = dv1 * pz + dv2 * qz;
		for (let k = 0; k < 3; k++) {
			const v = indices[t + k]!;
			gradU[v * 3] += ux;
			gradU[v * 3 + 1] += uy;
			gradU[v * 3 + 2] += uz;
			gradV[v * 3] += vx;
			gradV[v * 3 + 1] += vy;
			gradV[v * 3 + 2] += vz;
		}
	}

	const tangents = new Float32Array(vertexCount * 4);
	for (let v = 0; v < vertexCount; v++) {
		const nx = normals[v * 3]!;
		const ny = normals[v * 3 + 1]!;
		const nz = normals[v * 3 + 2]!;
		// Into the vertex's tangent plane: the averaged gradient leans off it on curved surfaces.
		const along = gradU[v * 3]! * nx + gradU[v * 3 + 1]! * ny + gradU[v * 3 + 2]! * nz;
		let tx = gradU[v * 3]! - along * nx;
		let ty = gradU[v * 3 + 1]! - along * ny;
		let tz = gradU[v * 3 + 2]! - along * nz;
		let length = Math.sqrt(tx * tx + ty * ty + tz * tz);
		if (!(length > 1e-12)) {
			// U constant here: any direction in the plane beats a zero tangent.
			const ax = Math.abs(nx) < 0.9 ? 1 : 0;
			const ay = 1 - ax;
			tx = ay * nz;
			ty = -ax * nz;
			tz = ax * ny - ay * nx;
			length = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
		}
		tx /= length;
		ty /= length;
		tz /= length;
		const bx = ny * tz - nz * ty;
		const by = nz * tx - nx * tz;
		const bz = nx * ty - ny * tx;
		const handedness = bx * gradV[v * 3]! + by * gradV[v * 3 + 1]! + bz * gradV[v * 3 + 2]!;
		tangents[v * 4] = tx;
		tangents[v * 4 + 1] = ty;
		tangents[v * 4 + 2] = tz;
		tangents[v * 4 + 3] = handedness < 0 ? -1 : 1;
	}
	return tangents;
}
