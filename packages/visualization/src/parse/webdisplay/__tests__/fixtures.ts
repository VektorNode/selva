import type { BuiltMeshBatch } from '@tests/helpers/mesh-batch-builder';
import { decodeBase64ToBinary } from '../../../shared/index.js';
import { CHUNK_GEOM, CHUNK_MATL, CHUNK_TABL, SLVM_MAGIC, SLVM_VERSION } from '../binary/slvm.js';

import type { SerializableMaterial } from '../types.js';

function varints(values: number[]): number[] {
	const out: number[] = [];
	for (let value of values) {
		while (value >= 0x80) {
			out.push((value & 0x7f) | 0x80);
			value >>>= 7;
		}
		out.push(value);
	}
	return out;
}

/**
 * Wraps a {@link buildMeshBatch} result in an SLVM v3 container, the shape the plugin sends. The
 * table carries no names, layers or ids, and one material run, so build with `materialCount: 1`:
 * the container stores meshes in table order and never their starts.
 */
export function wrapInSlvm(built: BuiltMeshBatch, materials?: SerializableMaterial[]): Uint8Array {
	const meshes = built.batch.groups.flatMap((g) => g.meshes);
	const table = new Uint8Array(
		varints([
			meshes.length,
			0, // curves
			0, // points
			0, // string pool
			...meshes.flatMap((m) => [m.vertexCount, m.indexCount / 3]),
			1, // material runs
			0,
			meshes.length,
			0, // names: none
			0, // layers: none
			0 // attrs
		])
	);
	const materialsJson = new TextEncoder().encode(
		JSON.stringify({ materials: materials ?? built.batch.materials })
	);
	const chunks: [number, Uint8Array][] = [
		[CHUNK_GEOM, decodeBase64ToBinary(built.batch.compressedData)],
		[CHUNK_TABL, table],
		[CHUNK_MATL, materialsJson]
	];

	const padded = (n: number) => n + ((4 - (n % 4)) % 4);
	const size = 12 + chunks.reduce((sum, [, payload]) => sum + 8 + padded(payload.length), 0);
	const bytes = new Uint8Array(size);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, SLVM_MAGIC, true);
	view.setUint32(4, SLVM_VERSION, true);
	view.setUint32(8, chunks.length, true);
	let offset = 12;
	for (const [type, payload] of chunks) {
		view.setUint32(offset, type, true);
		view.setUint32(offset + 4, payload.length, true);
		bytes.set(payload, offset + 8);
		offset += 8 + padded(payload.length);
	}
	return bytes;
}
