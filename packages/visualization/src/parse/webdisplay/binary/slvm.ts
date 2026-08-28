import { decodeUtf8, fail, maybeDecompress } from './geometry.js';

import type { BinaryMeshMetadata } from './header.js';
import type { MaterialGroup, MeshMetadata, SerializableMaterial } from '../types.js';

// ============================================================================
// SLVM v2 CONTAINER
// ============================================================================
// The C# mirror and normative spec is `SlvmDocument.cs`. Layout:
//
//   [4] magic "SLVM" | [4] version = 2 | [4] chunkCount
//   per chunk: [4] fourcc | [4] byteLen | payload | zero pad to 4
//
// Unknown chunk types are skipped by length — that's the format's extension mechanism. This
// decoder consumes GEOM (a nested bare SLVA/SLVZ blob), TABL (the columnar object table), MATL
// (materials JSON), TEXR (texture bytes) and the selva.gh EXTN; CRVS/PNTS (file-only item
// geometry) are skipped because items reach the web as JSON alongside the blob.

/** "SLVM" little-endian. */
export const SLVM_MAGIC = 0x4d564c53;
export const SLVM_VERSION = 2;

const CHUNK_GEOM = 0x4d4f4547; // "GEOM"
const CHUNK_TABL = 0x4c424154; // "TABL"
const CHUNK_MATL = 0x4c54414d; // "MATL"
const CHUNK_TEXR = 0x52584554; // "TEXR"
const CHUNK_EXTN = 0x4e545845; // "EXTN"

const SELVA_GH_NAMESPACE = 'selva.gh';

/** Material `map` prefix that references a TEXR chunk by index. */
const TEX_REF_PREFIX = 'slvm:tex:';

// String-column modes (see SlvmDocument.WriteStringColumn).
const NAMES_NONE = 0;
const NAMES_SEQUENTIAL = 1;
const NAMES_POOL = 2;

export function isSlvmContainer(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= 4 &&
		new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === SLVM_MAGIC
	);
}

export interface SlvmContainer {
	/** The GEOM payload: a bare SLVA/SLVZ blob whose embedded metadata is empty. */
	geometryBlob: Uint8Array;
	/** Batch metadata reconstructed from TABL + MATL + EXTN, in the legacy envelope shape. */
	metadata: BinaryMeshMetadata;
}

/**
 * Parses an SLVM v2 container down to its mesh geometry blob and the metadata the rest of the
 * pipeline expects. Group vertex/index windows are rebuilt as prefix sums over the table — the
 * format mandates geometry is concatenated in table order, so starts are never stored.
 *
 * @throws {VisualizationError} On bad magic, unknown version, or a truncated/malformed container.
 */
export function parseSlvmContainer(bytes: Uint8Array): SlvmContainer {
	const chunks = readChunks(bytes);

	let geometryBlob: Uint8Array | null = null;
	let tableBytes: Uint8Array | null = null;
	let materialsJson: string | null = null;
	const textures: Uint8Array[] = [];
	let sourceComponentId: string | undefined;

	for (const { type, payload } of chunks) {
		switch (type) {
			case CHUNK_GEOM:
				geometryBlob = payload;
				break;
			case CHUNK_TABL:
				tableBytes = maybeDecompress(payload);
				break;
			case CHUNK_MATL:
				materialsJson = decodeUtf8(payload);
				break;
			case CHUNK_TEXR:
				textures.push(payload);
				break;
			case CHUNK_EXTN:
				sourceComponentId = readSelvaExtension(payload) ?? sourceComponentId;
				break;
			// CRVS/PNTS and unknown chunks: skipped.
		}
	}

	if (geometryBlob === null) {
		throw fail('SLVM container has no GEOM chunk.', { chunkCount: chunks.length });
	}

	if (tableBytes === null) {
		throw fail('SLVM container has no TABL chunk.', { chunkCount: chunks.length });
	}

	const { groups } = parseTable(tableBytes);
	const materials = parseMaterials(materialsJson, textures);

	return {
		geometryBlob,
		metadata: { materials, groups, sourceComponentId }
	};
}

// ============================================================================
// CHUNK STREAM
// ============================================================================

function readChunks(bytes: Uint8Array): { type: number; payload: Uint8Array }[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < 12 || view.getUint32(0, true) !== SLVM_MAGIC) {
		throw fail('Not an SLVM container (bad magic).', { byteLength: bytes.byteLength });
	}

	const version = view.getUint32(4, true);
	if (version !== SLVM_VERSION) {
		throw fail(`Unsupported SLVM version: ${version}`, { expectedVersion: SLVM_VERSION });
	}

	const count = view.getUint32(8, true);
	const chunks: { type: number; payload: Uint8Array }[] = [];
	let offset = 12;
	for (let i = 0; i < count; i++) {
		if (offset + 8 > bytes.byteLength) {
			throw fail('Truncated SLVM chunk header.', { offset, chunkIndex: i });
		}

		const type = view.getUint32(offset, true);
		const len = view.getUint32(offset + 4, true);
		offset += 8;
		if (offset + len > bytes.byteLength) {
			throw fail('Truncated SLVM chunk payload.', { offset, chunkIndex: i, byteLen: len });
		}

		chunks.push({ type, payload: bytes.subarray(offset, offset + len) });
		offset += len + ((4 - (len % 4)) % 4);
	}

	return chunks;
}

// ============================================================================
// TABL
// ============================================================================

interface TableReader {
	bytes: Uint8Array;
	pos: number;
}

function readVarint(r: TableReader): number {
	let value = 0;
	let shift = 0;
	for (;;) {
		if (r.pos >= r.bytes.byteLength || shift > 28) {
			throw fail('Malformed varint in SLVM table.', { pos: r.pos });
		}

		const b = r.bytes[r.pos++]!;
		value |= (b & 0x7f) << shift;
		if ((b & 0x80) === 0) {
			return value >>> 0;
		}

		shift += 7;
	}
}

function readStringColumn(r: TableReader, objectCount: number, pool: string[]): string[] {
	const mode = r.bytes[r.pos++];
	const result = new Array<string>(objectCount);
	switch (mode) {
		case NAMES_NONE:
			result.fill('');
			break;
		case NAMES_SEQUENTIAL:
			for (let i = 0; i < objectCount; i++) {
				result[i] = String(i + 1);
			}

			break;
		case NAMES_POOL:
			for (let i = 0; i < objectCount; i++) {
				result[i] = pool[readVarint(r)] ?? '';
			}

			break;
		default:
			throw fail(`Unknown SLVM string column mode: ${mode}`, { pos: r.pos });
	}

	return result;
}

function parseTable(bytes: Uint8Array): { groups: MaterialGroup[] } {
	const r: TableReader = { bytes, pos: 0 };

	const meshCount = readVarint(r);
	const curveCount = readVarint(r);
	const pointCount = readVarint(r);
	const objectCount = meshCount + curveCount + pointCount;

	const poolCount = readVarint(r);
	const pool = new Array<string>(poolCount);
	for (let i = 0; i < poolCount; i++) {
		const len = readVarint(r);
		pool[i] = decodeUtf8(bytes.subarray(r.pos, r.pos + len));
		r.pos += len;
	}

	const vertexCounts = new Array<number>(meshCount);
	const triCounts = new Array<number>(meshCount);
	for (let i = 0; i < meshCount; i++) {
		vertexCounts[i] = readVarint(r);
		triCounts[i] = readVarint(r);
	}

	for (let i = 0; i < curveCount; i++) {
		readVarint(r); // curve point counts — items don't reach this decoder
	}

	const runCount = readVarint(r);
	const runs: { materialId: number; meshCount: number }[] = [];
	for (let i = 0; i < runCount; i++) {
		runs.push({ materialId: readVarint(r), meshCount: readVarint(r) });
	}

	let originalIndices: number[] | null = null;
	if (bytes[r.pos++] === 1) {
		originalIndices = new Array<number>(objectCount);
		for (let i = 0; i < objectCount; i++) {
			originalIndices[i] = readVarint(r);
		}
	}

	const names = readStringColumn(r, objectCount, pool);
	const layers = readStringColumn(r, objectCount, pool);

	const attrs = new Array<Record<string, string> | undefined>(objectCount);
	const attrCount = readVarint(r);
	for (let a = 0; a < attrCount; a++) {
		const key = pool[readVarint(r)] ?? '';
		const n = readVarint(r);
		const indices = new Array<number>(n);
		let idx = 0;
		for (let i = 0; i < n; i++) {
			idx += readVarint(r);
			indices[i] = idx;
		}

		for (let i = 0; i < n; i++) {
			const value = pool[readVarint(r)] ?? '';
			const objIndex = indices[i]!;
			(attrs[objIndex] ??= {})[key] = value;
		}
	}

	// A table with meshes but no material runs (a foreign writer) gets one implicit group.
	const effectiveRuns = runs.length > 0 || meshCount === 0 ? runs : [{ materialId: 0, meshCount }];

	const groups: MaterialGroup[] = [];
	let meshIndex = 0;
	let vertexStart = 0;
	let indexStart = 0;
	for (const run of effectiveRuns) {
		const meshes: MeshMetadata[] = [];
		for (let i = 0; i < run.meshCount && meshIndex < meshCount; i++, meshIndex++) {
			meshes.push({
				name: names[meshIndex]!,
				layer: layers[meshIndex]!,
				originalIndex: originalIndices?.[meshIndex] ?? meshIndex,
				vertexCount: vertexCounts[meshIndex]!,
				indexCount: triCounts[meshIndex]! * 3,
				vertexStart,
				indexStart,
				metadata: attrs[meshIndex] ?? {}
			});
			vertexStart += vertexCounts[meshIndex]!;
			indexStart += triCounts[meshIndex]! * 3;
		}

		groups.push({ materialId: run.materialId, meshes });
	}

	return { groups };
}

// ============================================================================
// MATL + TEXR
// ============================================================================

function parseMaterials(json: string | null, textures: Uint8Array[]): SerializableMaterial[] {
	if (json === null) {
		return [];
	}

	let materials: SerializableMaterial[];
	try {
		materials = (JSON.parse(json) as { materials?: SerializableMaterial[] }).materials ?? [];
	} catch (error) {
		throw fail(
			`Failed to parse SLVM materials JSON: ${error instanceof Error ? error.message : String(error)}`,
			{ byteLength: json.length }
		);
	}

	for (const material of materials) {
		if (material.map?.startsWith(TEX_REF_PREFIX)) {
			const texIndex = Number(material.map.slice(TEX_REF_PREFIX.length));
			const tex = textures[texIndex];
			if (tex !== undefined) {
				material.map = textureToDataUri(tex);
			}
		}
	}

	return materials;
}

/** TEXR payload is [varint mimeLen][mime utf8][image bytes]; downstream wants a data URI. */
function textureToDataUri(payload: Uint8Array): string {
	const r: TableReader = { bytes: payload, pos: 0 };
	const mimeLen = readVarint(r);
	const mime = decodeUtf8(payload.subarray(r.pos, r.pos + mimeLen));
	const data = payload.subarray(r.pos + mimeLen);

	// btoa takes a binary string; build it in chunks to stay clear of argument-count limits.
	let binary = '';
	const step = 0x8000;
	for (let i = 0; i < data.byteLength; i += step) {
		binary += String.fromCharCode(...data.subarray(i, i + step));
	}

	return `data:${mime};base64,${btoa(binary)}`;
}

// ============================================================================
// EXTN
// ============================================================================

/**
 * Returns the selva.gh batch id, or undefined for foreign namespaces. `sourceComponentId` is the
 * pre-rename spelling and is still accepted: a container written before the rename would otherwise
 * lose its identity, taking every hidden and selected object in the viewer with it.
 */
function readSelvaExtension(payload: Uint8Array): string | undefined {
	const r: TableReader = { bytes: payload, pos: 0 };
	const nsLen = readVarint(r);
	const ns = decodeUtf8(payload.subarray(r.pos, r.pos + nsLen));
	if (ns !== SELVA_GH_NAMESPACE) {
		return undefined;
	}

	const json = decodeUtf8(payload.subarray(r.pos + nsLen));
	try {
		const ext = JSON.parse(json) as { batchId?: string; sourceComponentId?: string };
		return ext.batchId ?? ext.sourceComponentId;
	} catch {
		return undefined;
	}
}
