import { UV_FORMAT_FLOAT32 } from './header.js';
import { fail, readFloat32Vertices, readUint16Array, unzigzag } from './geometry.js';

/** Byte size of the UV chunk header: uvFormat(u32) + uvOrigin(2×f64) + uvScale(2×f64). */
const UV_CHUNK_HEADER_BYTES = 4 + 16 + 16;

/**
 * Parses the trailing UV chunk into absolute Float32 u,v pairs. Quantized UVs reconstruct as
 * `origin + q * scale` (unsigned q), undoing the per-component delta+zigzag filter when set;
 * float32 UVs are copied out as-is (never filtered).
 */
export function parseUvChunk(
	bytes: Uint8Array,
	view: DataView,
	offset: number,
	vertexCount: number,
	deltaEncoded: boolean
): { uvs: Float32Array; offset: number } {
	if (offset + UV_CHUNK_HEADER_BYTES > bytes.byteLength) {
		throw fail('Insufficient data to read UV chunk header.', {
			expectedBytes: UV_CHUNK_HEADER_BYTES,
			availableBytes: bytes.byteLength - offset,
			offset
		});
	}

	const uvFormat = view.getUint32(offset, true);
	offset += 4;
	const originU = view.getFloat64(offset, true);
	offset += 8;
	const originV = view.getFloat64(offset, true);
	offset += 8;
	const scaleU = view.getFloat64(offset, true);
	offset += 8;
	const scaleV = view.getFloat64(offset, true);
	offset += 8;

	const componentCount = vertexCount * 2;
	const useFloat32 = uvFormat === UV_FORMAT_FLOAT32;
	const dataByteLength = componentCount * (useFloat32 ? 4 : 2);
	if (offset + dataByteLength > bytes.byteLength) {
		throw fail('Insufficient data to read UV chunk.', {
			expectedBytes: dataByteLength,
			availableBytes: bytes.byteLength - offset,
			offset,
			uvFormat,
			vertexCount
		});
	}

	const absoluteOffset = bytes.byteOffset + offset;
	let uvs: Float32Array;
	if (useFloat32) {
		// Copy (not view) so the attribute owns its memory like the quantized path.
		uvs = readFloat32Vertices(bytes.buffer, absoluteOffset, componentCount).slice();
	} else {
		const raw = readUint16Array(bytes.buffer, absoluteOffset, componentCount);
		uvs = new Float32Array(componentCount);
		let qu = 0;
		let qv = 0;
		for (let i = 0; i < componentCount; i += 2) {
			if (deltaEncoded) {
				qu = (qu + unzigzag(raw[i]!)) & 0xffff;
				qv = (qv + unzigzag(raw[i + 1]!)) & 0xffff;
			} else {
				qu = raw[i]!;
				qv = raw[i + 1]!;
			}
			uvs[i] = originU + qu * scaleU;
			uvs[i + 1] = originV + qv * scaleV;
		}
	}

	return { uvs, offset: offset + dataByteLength };
}

/**
 * Parses the trailing vertex-color chunk into raw r,g,b bytes, undoing the per-channel wrapped
 * 8-bit delta+zigzag filter when the blob-wide delta flag is set.
 */
export function parseColorChunk(
	bytes: Uint8Array,
	offset: number,
	vertexCount: number,
	deltaEncoded: boolean
): Uint8Array {
	const byteLength = vertexCount * 3;
	if (offset + byteLength > bytes.byteLength) {
		throw fail('Insufficient data to read vertex-color chunk.', {
			expectedBytes: byteLength,
			availableBytes: bytes.byteLength - offset,
			offset,
			vertexCount
		});
	}

	const raw = bytes.subarray(offset, offset + byteLength);
	if (!deltaEncoded) {
		return raw.slice();
	}

	const colors = new Uint8Array(byteLength);
	let r = 0;
	let g = 0;
	let b = 0;
	for (let i = 0; i < byteLength; i += 3) {
		r = (r + unzigzag(raw[i]!)) & 0xff;
		g = (g + unzigzag(raw[i + 1]!)) & 0xff;
		b = (b + unzigzag(raw[i + 2]!)) & 0xff;
		colors[i] = r;
		colors[i + 1] = g;
		colors[i + 2] = b;
	}
	return colors;
}

// ============================================================================
