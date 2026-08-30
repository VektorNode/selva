/**
 * {@link assembleGeometries} is the hot, pure part of batch parsing: undoes the delta filter on
 * the raw wire arrays, dequantizes int16 positions to world floats, slices/rebases per-geometry
 * windows and computes vertex normals.
 * Everything it needs travels as typed arrays, so the whole stage runs in a Worker and the main
 * thread only wraps the returned buffers into `BufferGeometry` objects.
 *
 * Like `edge-extract.ts`, it's a single self-contained function with zero outer captures (only
 * `Math` and its arguments) so `Function.prototype.toString` yields code that runs unchanged
 * inside a blob-URL Worker ({@link meshAssemblyWorkerSource}) — bundler-agnostic by construction.
 * That forces duplicating small helpers from `binary-parser.ts` (unzigzag/delta decode);
 * equivalence with the synchronous path is pinned by tests.
 */

export interface AssemblyWindow {
	vertexStart: number;
	vertexCount: number;
	indexStart: number;
	indexCount: number;
}

export interface AssemblyJob {
	kind: 'merged' | 'single';
	windows: AssemblyWindow[];
}

export interface AssemblyInput {
	/**
	 * Raw wire vertex components: byte planes (Uint8) when planar-byte-split, zigzag deltas
	 * (Uint16) when delta-encoded, else absolute.
	 */
	vertexData: Uint8Array | Uint16Array | Int16Array | Float32Array;
	isFloat32: boolean;
	deltaEncoded: boolean;
	/** v4 byte-plane layout on the delta-filtered streams — see FLAG_PLANAR_BYTESPLIT. */
	planarByteSplit: boolean;
	/** Wire index width; required because planar `indexData` is a bare byte stream. */
	uint16Indices: boolean;
	origin: [number, number, number];
	scale: [number, number, number];
	/** Raw wire indices: byte planes when planar-byte-split, zigzag deltas when delta-encoded. */
	indexData: Uint8Array | Uint16Array | Uint32Array;
	/** Already-decoded absolute UV pairs / RGB bytes (small, decoded on the main thread). */
	uvs: Float32Array | null;
	colors: Uint8Array | null;
	jobs: AssemblyJob[];
}

export interface AssembledGeometry {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	uvs: Float32Array | null;
	colors: Uint8Array | null;
}

export function assembleGeometries(input: AssemblyInput): AssembledGeometry[] {
	// NOTE: self-contained by design (worker stringification) — no outer references besides Math.
	const {
		isFloat32,
		deltaEncoded,
		planarByteSplit,
		uint16Indices,
		origin,
		scale,
		uvs,
		colors,
		jobs
	} = input;

	const unzigzag = (zz: number): number => (zz >>> 1) ^ -(zz & 1);

	// --- Undo the delta filter (whole-array: each value depends on its predecessor) ------------
	let worldVertices: Float32Array;
	if (isFloat32) {
		worldVertices = input.vertexData as Float32Array;
	} else {
		let quantized: Int16Array;
		if (planarByteSplit) {
			// v4 layout: [Xlo][Ylo][Zlo][Xhi][Yhi][Zhi] byte planes of the zigzag deltas.
			const planes = input.vertexData as Uint8Array;
			const n = planes.length / 6;
			quantized = new Int16Array(n * 3);
			let px = 0;
			let py = 0;
			let pz = 0;
			for (let i = 0; i < n; i++) {
				px = ((px + unzigzag(planes[i] | (planes[n * 3 + i] << 8))) << 16) >> 16;
				py = ((py + unzigzag(planes[n + i] | (planes[n * 4 + i] << 8))) << 16) >> 16;
				pz = ((pz + unzigzag(planes[n * 2 + i] | (planes[n * 5 + i] << 8))) << 16) >> 16;
				quantized[i * 3] = px;
				quantized[i * 3 + 1] = py;
				quantized[i * 3 + 2] = pz;
			}
		} else if (deltaEncoded) {
			const zigzagged = input.vertexData as Uint16Array;
			quantized = new Int16Array(zigzagged.length);
			let px = 0;
			let py = 0;
			let pz = 0;
			for (let i = 0; i < zigzagged.length; i += 3) {
				px = ((px + unzigzag(zigzagged[i])) << 16) >> 16;
				py = ((py + unzigzag(zigzagged[i + 1])) << 16) >> 16;
				pz = ((pz + unzigzag(zigzagged[i + 2])) << 16) >> 16;
				quantized[i] = px;
				quantized[i + 1] = py;
				quantized[i + 2] = pz;
			}
		} else {
			quantized = input.vertexData as Int16Array;
		}
		// Dequantize: world = origin + (q + 32767) * scale (matches the writer/binary-parser).
		worldVertices = new Float32Array(quantized.length);
		const ox = origin[0];
		const oy = origin[1];
		const oz = origin[2];
		const sx = scale[0];
		const sy = scale[1];
		const sz = scale[2];
		for (let i = 0; i < quantized.length; i += 3) {
			worldVertices[i] = ox + (quantized[i] + 32767) * sx;
			worldVertices[i + 1] = oy + (quantized[i + 1] + 32767) * sy;
			worldVertices[i + 2] = oz + (quantized[i + 2] + 32767) * sz;
		}
	}

	let indices: Uint16Array | Uint32Array;
	if (planarByteSplit) {
		const planes = input.indexData as Uint8Array;
		if (uint16Indices) {
			const count = planes.length / 2;
			const out = new Uint16Array(count);
			let prev = 0;
			for (let i = 0; i < count; i++) {
				prev = (prev + unzigzag(planes[i] | (planes[count + i] << 8))) & 0xffff;
				out[i] = prev;
			}
			indices = out;
		} else {
			const count = planes.length / 4;
			const out = new Uint32Array(count);
			let prev = 0;
			for (let i = 0; i < count; i++) {
				const zz =
					(planes[i] |
						(planes[count + i] << 8) |
						(planes[count * 2 + i] << 16) |
						(planes[count * 3 + i] << 24)) >>>
					0;
				prev = (prev + unzigzag(zz)) >>> 0;
				out[i] = prev;
			}
			indices = out;
		}
	} else if (deltaEncoded) {
		const zigzagged = input.indexData as Uint16Array | Uint32Array;
		if (zigzagged instanceof Uint16Array) {
			const out = new Uint16Array(zigzagged.length);
			let prev = 0;
			for (let i = 0; i < zigzagged.length; i++) {
				prev = (prev + unzigzag(zigzagged[i])) & 0xffff;
				out[i] = prev;
			}
			indices = out;
		} else {
			const out = new Uint32Array(zigzagged.length);
			let prev = 0;
			for (let i = 0; i < zigzagged.length; i++) {
				prev = (prev + unzigzag(zigzagged[i])) >>> 0;
				out[i] = prev;
			}
			indices = out;
		}
	} else {
		indices = input.indexData as Uint16Array | Uint32Array;
	}

	const totalVertexCount = worldVertices.length / 3;
	for (let i = 0; i < indices.length; i++) {
		if (indices[i] >= totalVertexCount) {
			throw new Error(`Index ${indices[i]} out of range of vertexCount ${totalVertexCount}`);
		}
	}

	// --- Assemble each job: window copies, rebased indices, area-weighted vertex normals --------
	const results: AssembledGeometry[] = [];

	for (const job of jobs) {
		let vertexTotal = 0;
		let indexTotal = 0;
		for (const window of job.windows) {
			vertexTotal += window.vertexCount;
			indexTotal += window.indexCount;
		}

		const positions = new Float32Array(vertexTotal * 3);
		const outIndices = new Uint32Array(indexTotal);
		const outUvs = uvs ? new Float32Array(vertexTotal * 2) : null;
		const outColors = colors ? new Uint8Array(vertexTotal * 3) : null;

		let vertexCursor = 0;
		let indexCursor = 0;
		for (const window of job.windows) {
			const componentStart = window.vertexStart * 3;
			positions.set(
				worldVertices.subarray(componentStart, componentStart + window.vertexCount * 3),
				vertexCursor * 3
			);
			if (outUvs && uvs) {
				outUvs.set(
					uvs.subarray(window.vertexStart * 2, (window.vertexStart + window.vertexCount) * 2),
					vertexCursor * 2
				);
			}
			if (outColors && colors) {
				outColors.set(
					colors.subarray(componentStart, componentStart + window.vertexCount * 3),
					vertexCursor * 3
				);
			}

			const windowStart = window.vertexStart;
			const windowEnd = window.vertexStart + window.vertexCount;
			const shift = vertexCursor - window.vertexStart;
			for (let i = 0; i < window.indexCount; i++) {
				const indexValue = indices[window.indexStart + i];
				if (indexValue < windowStart || indexValue >= windowEnd) {
					throw new Error(
						`Index ${indexValue} outside vertex window [${windowStart}, ${windowEnd})`
					);
				}
				outIndices[indexCursor + i] = indexValue + shift;
			}

			vertexCursor += window.vertexCount;
			indexCursor += window.indexCount;
		}

		// Vertex normals, mirroring THREE.BufferGeometry.computeVertexNormals: accumulate the
		// non-normalized (area-weighted) face normal cross((c-b),(a-b)) onto each corner, then
		// normalize per vertex.
		const normals = new Float32Array(vertexTotal * 3);
		for (let i = 0; i < outIndices.length; i += 3) {
			const a = outIndices[i] * 3;
			const b = outIndices[i + 1] * 3;
			const c = outIndices[i + 2] * 3;

			const cbx = positions[c] - positions[b];
			const cby = positions[c + 1] - positions[b + 1];
			const cbz = positions[c + 2] - positions[b + 2];
			const abx = positions[a] - positions[b];
			const aby = positions[a + 1] - positions[b + 1];
			const abz = positions[a + 2] - positions[b + 2];

			const nx = cby * abz - cbz * aby;
			const ny = cbz * abx - cbx * abz;
			const nz = cbx * aby - cby * abx;

			normals[a] += nx;
			normals[a + 1] += ny;
			normals[a + 2] += nz;
			normals[b] += nx;
			normals[b + 1] += ny;
			normals[b + 2] += nz;
			normals[c] += nx;
			normals[c + 1] += ny;
			normals[c + 2] += nz;
		}
		for (let i = 0; i < normals.length; i += 3) {
			const x = normals[i];
			const y = normals[i + 1];
			const z = normals[i + 2];
			const length = Math.sqrt(x * x + y * y + z * z) || 1;
			normals[i] = x / length;
			normals[i + 1] = y / length;
			normals[i + 2] = z / length;
		}

		results.push({
			positions,
			normals,
			indices: outIndices,
			uvs: outUvs,
			colors: outColors
		});
	}

	return results;
}

/**
 * Worker script running {@link assembleGeometries} off the main thread. Protocol: receives
 * `{id, input}`, replies `{id, geometries}` with every output buffer transferred, or
 * `{id, error}`. Pinned by a test that evals this source against a stub `self`.
 */
export function meshAssemblyWorkerSource(): string {
	return [
		`const assemble = ${assembleGeometries.toString()};`,
		`self.onmessage = (event) => {`,
		`  const { id, input } = event.data;`,
		`  try {`,
		`    const geometries = assemble(input);`,
		`    const transfer = [];`,
		`    for (const g of geometries) {`,
		`      transfer.push(g.positions.buffer, g.normals.buffer, g.indices.buffer);`,
		`      if (g.uvs) transfer.push(g.uvs.buffer);`,
		`      if (g.colors) transfer.push(g.colors.buffer);`,
		`    }`,
		`    self.postMessage({ id, geometries }, transfer);`,
		`  } catch (error) {`,
		`    self.postMessage({ id, error: String((error && error.message) || error) });`,
		`  }`,
		`};`
	].join('\n');
}
