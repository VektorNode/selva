import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import { FLAG_FLOAT32, parseBinaryMeshBatch, parseBinaryMeshBatchRaw } from './binary-parser.js';
import { geometryCacheGet, geometryCachePut } from './geometry-cache.js';

import {
	ASSEMBLY_WORKER_MIN_TRIANGLES,
	getAssemblyWorker,
	requestAssembly
} from './batch/assembly-worker.js';
import { createMaterial } from './batch/materials.js';
import {
	createIndividualMeshes,
	createMergedMesh,
	finalizeMergedMesh,
	finalizeSingleMesh
} from './batch/merge.js';
import {
	dequantizeInt16,
	maybeRotateFloat32Vertices,
	validateGroupMetadata
} from './batch/metadata.js';

import type { AssembledGeometry, AssemblyJob, AssemblyWindow } from './mesh-assembly.js';
import type { ParsedBinaryMeshBatch } from './binary-parser.js';
import type {
	DisplayBatch,
	MaterialAppearanceOptions,
	MaterialGroup,
	MeshBatchParsingOptions,
	MeshMetadata,
	SerializableMaterial
} from './types.js';
/** Internal telemetry only (not exposed in public options). */
interface ParseTelemetry {
	parseTime?: number;
	perfStart?: number;
}

/**
 * Parses a batched mesh JSON and creates Three.js meshes.
 *
 * The geometry payload is the binary "SLVA" blob produced by the C# `BinaryGeometryWriter`,
 * base64-encoded into the outer JSON envelope. We `JSON.parse` the small envelope, then hand the
 * blob to `parseBinaryMeshBatch` which decodes the geometry without ever turning it into a string.
 *
 * An invalid JSON envelope (not a batch at all) logs and returns `[]` — that is the
 * "genuinely absent data" case. A batch whose *blob* is corrupt, truncated, or unsupported throws
 * instead of silently rendering an empty scene.
 *
 * @param batchJson - JSON string containing the batched mesh data
 * @param options - Rendering options
 * @returns Promise resolving to array of Three.js mesh objects
 * @throws {VisualizationError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
 */
export async function parseMeshBatch(
	batchJson: string,
	options?: MeshBatchParsingOptions
): Promise<THREE.Mesh[]> {
	const { debug = false } = options ?? {};

	const perfStart = debug ? performance.now() : 0;

	// Narrow catch: only the envelope JSON.parse is allowed to degrade to []. Blob parse errors
	// from parseMeshBatchObject propagate — see that entry point's contract.
	let batch: DisplayBatch;
	const parseStart = performance.now();
	try {
		batch = JSON.parse(batchJson);
	} catch (error) {
		getLogger().error('Error parsing mesh batch envelope JSON:', error);
		return [];
	}
	const parseTime = performance.now() - parseStart;

	return await parseMeshBatchObject(batch, options, { parseTime, perfStart });
}

/**
 * Parses a DisplayBatch object and creates Three.js meshes from its mesh blob.
 *
 * The path is synchronous internally — `parseBinaryMeshBatch` does no IO, just typed-array views
 * over the blob. The function stays `async` so callers don't have to change shape if we move
 * parsing into a worker later.
 *
 * A batch with no `compressedData` (genuinely empty/absent geometry) resolves to `[]`. A corrupt,
 * truncated, or unsupported blob throws so callers get a signal instead of a silent empty scene —
 * `getThreeMeshesFromComputeResponse` documents (and now delivers) exactly that rethrow.
 *
 * @param batch - DisplayBatch object
 * @param options - Rendering options
 * @returns Promise resolving to array of Three.js mesh objects
 * @throws {VisualizationError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
 */
export async function parseMeshBatchObject(
	batch: DisplayBatch,
	options?: MeshBatchParsingOptions,
	/** @internal Timings threaded from an outer entry point; not a caller option. */
	telemetry?: ParseTelemetry
): Promise<THREE.Mesh[]> {
	const { mergeByMaterial = true, applyTransforms = true, debug = false, material } = options ?? {};
	const { parseTime = 0, perfStart = debug ? performance.now() : 0 } = telemetry ?? {};

	if (!batch.compressedData) {
		// No blob at all — an items-only or empty batch. This is the one entry-point path that
		// legitimately yields [] rather than throwing.
		return [];
	}

	// Off-thread path (audit P2): heavy batches decode+assemble in a worker; null → do it here.
	const workerMeshes = await tryBuildViaWorker(batch.compressedData, {
		mergeByMaterial,
		applyTransforms,
		debug,
		material,
		fallback: {
			materials: batch.materials,
			groups: batch.groups,
			sourceComponentId: batch.sourceComponentId
		}
	});
	if (workerMeshes) return workerMeshes;

	const decodeStart = performance.now();
	const parsed = parseBinaryMeshBatch(batch.compressedData);
	const decodeTime = performance.now() - decodeStart;

	const blobBytes = debug ? approximateBase64DecodedBytes(batch.compressedData) : 0;

	return buildMeshesFromParsed(parsed, {
		mergeByMaterial,
		applyTransforms,
		debug,
		material,
		parseTime,
		decodeTime,
		perfStart,
		blobBytes,
		fallback: {
			materials: batch.materials,
			groups: batch.groups,
			sourceComponentId: batch.sourceComponentId
		}
	});
}

/**
 * Parses a raw binary mesh batch blob (SLVA wire format) and creates Three.js meshes.
 *
 * Use this entry point when the blob arrives as a binary WebSocket frame (Phase 1b transport):
 * the JSON envelope no longer carries `displayData`, so there's nothing to `JSON.parse`. The blob
 * is self-describing — materials, groups, and `sourceComponentId` come from its embedded metadata
 * header.
 *
 * @param blob - Raw blob bytes from a binary WebSocket frame.
 * @param options - Rendering options.
 * @returns Promise resolving to array of Three.js mesh objects.
 * @throws {VisualizationError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
 */
export async function parseMeshBatchBlob(
	blob: ArrayBuffer | Uint8Array,
	options?: MeshBatchParsingOptions
): Promise<THREE.Mesh[]> {
	const { mergeByMaterial = true, applyTransforms = true, debug = false, material } = options ?? {};

	const perfStart = debug ? performance.now() : 0;

	// Off-thread path (audit P2): heavy batches decode+assemble in a worker; null → do it here.
	const workerMeshes = await tryBuildViaWorker(blob, {
		mergeByMaterial,
		applyTransforms,
		debug,
		material
	});
	if (workerMeshes) return workerMeshes;

	const decodeStart = performance.now();
	const parsed = parseBinaryMeshBatch(blob);
	const decodeTime = performance.now() - decodeStart;

	const blobBytes = blob.byteLength;

	return buildMeshesFromParsed(parsed, {
		mergeByMaterial,
		applyTransforms,
		debug,
		material,
		parseTime: 0,
		decodeTime,
		perfStart,
		blobBytes
	});
}

interface BuildOptions {
	mergeByMaterial: boolean;
	applyTransforms: boolean;
	debug: boolean;
	material?: MaterialAppearanceOptions;
	parseTime: number;
	decodeTime: number;
	perfStart: number;
	blobBytes: number;
	/** Outer-envelope fallback when the blob's metadata is missing fields (defensive). */
	fallback?: {
		materials?: SerializableMaterial[];
		groups?: MaterialGroup[];
		sourceComponentId?: string;
	};
}

function buildMeshesFromParsed(
	parsed: ParsedBinaryMeshBatch,
	opts: BuildOptions
): Promise<THREE.Mesh[]> {
	const {
		mergeByMaterial,
		applyTransforms,
		debug,
		material: materialAppearance,
		parseTime,
		decodeTime,
		perfStart,
		blobBytes,
		fallback
	} = opts;

	const materialsSrc = parsed.metadata.materials ?? fallback?.materials ?? [];
	const groups = parsed.metadata.groups ?? fallback?.groups ?? [];
	// Prefer the outer envelope's sourceComponentId over the blob's embedded one. The blob bakes in
	// the id at encode time, but a reloaded part (e.g. from a .dmf instanced many times) re-stamps a
	// fresh id on the envelope to keep web pick identity distinct per placement. The blob value is
	// the fallback for the raw-blob transport, which has no envelope.
	const sourceComponentId = fallback?.sourceComponentId ?? parsed.metadata.sourceComponentId;

	const isFloat32 = (parsed.flags & FLAG_FLOAT32) !== 0;

	// Group metadata arrives as embedded (or envelope) JSON and is used arithmetically below —
	// unchecked, a bad vertexStart/indexStart wraps rebased indices into a Uint32Array, `subarray`
	// silently clamps, and an out-of-range materialId feeds `undefined` into `new THREE.Mesh`.
	// Fail the parse instead of silently corrupting the render.
	validateGroupMetadata(
		groups,
		materialsSrc.length,
		parsed.vertices.length / 3,
		parsed.indices.length
	);

	// Dequantize once up-front into a single Float32Array. Downstream code (per-group merging,
	// computeVertexNormals, ground-offset) all expect world-unit floats, and a single
	// linear pass over the int16 buffer is far cheaper than the legacy gunzip + base64 path.
	// No rotation happens here: the scene uses Rhino's Z-up frame, so vertices pass through in the
	// frame they arrived in (see ../coordinate-transform.ts). `applyTransforms` is inert.
	const worldVertices = isFloat32
		? maybeRotateFloat32Vertices(parsed.vertices as Float32Array, applyTransforms)
		: dequantizeInt16(parsed.vertices as Int16Array, parsed.origin, parsed.scale, applyTransforms);

	if (debug) {
		const wireBytes = parsed.vertices.byteLength + parsed.indices.byteLength;
		getLogger().debug('Mesh Batch Stats:');
		getLogger().debug(`  Materials: ${materialsSrc.length} | Groups: ${groups.length}`);
		getLogger().debug(
			`  Vertices: ${parsed.vertices.length / 3} | Indices: ${parsed.indices.length}`
		);
		getLogger().debug(`  Format: ${isFloat32 ? 'float32' : 'int16 quantized'}`);
		getLogger().debug(
			`  Blob: ${(blobBytes / 1024 / 1024).toFixed(2)} MB | Geometry on wire: ${(wireBytes / 1024 / 1024).toFixed(2)} MB`
		);
	}

	const meshCreateStart = performance.now();
	// Vertex colors are batch-wide when present (meshes without real colors carry a white fill,
	// which multiplies to identity), so the material can enable vertexColors unconditionally.
	const materials = materialsSrc.map((m) =>
		createMaterial(m, {
			vertexColors: parsed.colors != null,
			appearance: materialAppearance
		})
	);

	const meshes: THREE.Mesh[] = [];

	for (const group of groups) {
		if (mergeByMaterial && group.meshes.length > 1) {
			const mergedMesh = createMergedMesh(
				group,
				worldVertices,
				parsed.indices,
				materials,
				parsed.uvs,
				parsed.colors
			);
			mergedMesh.userData.sourceComponentId = sourceComponentId ?? null;
			meshes.push(mergedMesh);
		} else {
			const individualMeshes = createIndividualMeshes(
				group,
				worldVertices,
				parsed.indices,
				materials,
				parsed.uvs,
				parsed.colors
			);
			for (const mesh of individualMeshes) {
				mesh.userData.sourceComponentId = sourceComponentId ?? null;
			}
			meshes.push(...individualMeshes);
		}
	}

	const meshCreateTime = performance.now() - meshCreateStart;

	if (debug) {
		const totalTime = performance.now() - perfStart;
		getLogger().debug('Performance:');
		if (parseTime > 0) getLogger().debug(`  Parse JSON: ${parseTime.toFixed(2)}ms`);
		getLogger().debug(`  Decode binary: ${decodeTime.toFixed(2)}ms`);
		getLogger().debug(`  Create Meshes: ${meshCreateTime.toFixed(2)}ms`);
		getLogger().debug(`  Total: ${totalTime.toFixed(2)}ms`);
	}

	return Promise.resolve(meshes);
}

// ============================================================================
// OFF-THREAD ASSEMBLY (audit P2 — docs/plans/5.display-pipeline-performance-audit.md)
// ============================================================================

interface WorkerPathOptions {
	mergeByMaterial: boolean;
	applyTransforms: boolean;
	debug: boolean;
	material?: MaterialAppearanceOptions;
	fallback?: BuildOptions['fallback'];
}

/**
 * Attempt the off-thread build. Returns the finished meshes, or `null` when the worker path
 * doesn't apply (no Worker, small batch, worker crashed) — the caller then runs the synchronous
 * path. Malformed-blob/metadata errors throw, matching the entry points' contract either way.
 *
 * Cache interplay: the worker always assembles and fingerprints every geometry (decode is
 * whole-array work anyway), and the main thread prefers an existing cached geometry over the
 * returned buffers — so cache hits skip the GPU re-upload, and the wasted worker CPU for them is
 * off the critical path by definition.
 */
async function tryBuildViaWorker(
	input: ArrayBuffer | Uint8Array | string,
	opts: WorkerPathOptions
): Promise<THREE.Mesh[] | null> {
	if (typeof Worker === 'undefined') return null;

	const raw = parseBinaryMeshBatchRaw(input);
	if (raw.indexData.length / 3 < ASSEMBLY_WORKER_MIN_TRIANGLES) return null;
	const worker = getAssemblyWorker();
	if (!worker) return null;

	const materialsSrc = raw.metadata.materials ?? opts.fallback?.materials ?? [];
	const groups = raw.metadata.groups ?? opts.fallback?.groups ?? [];
	const sourceComponentId = opts.fallback?.sourceComponentId ?? raw.metadata.sourceComponentId;
	validateGroupMetadata(groups, materialsSrc.length, raw.vertexCount, raw.indexData.length);

	// Same job branching as buildMeshesFromParsed, with a parallel ref list to wrap results.
	interface JobRef {
		kind: 'merged' | 'single';
		group: MaterialGroup;
		meshMeta?: MeshMetadata;
	}
	const windowOf = (m: MeshMetadata): AssemblyWindow => ({
		vertexStart: m.vertexStart,
		vertexCount: m.vertexCount,
		indexStart: m.indexStart,
		indexCount: m.indexCount
	});
	const jobs: AssemblyJob[] = [];
	const jobRefs: JobRef[] = [];
	for (const group of groups) {
		if (opts.mergeByMaterial && group.meshes.length > 1) {
			jobs.push({ kind: 'merged', windows: group.meshes.map(windowOf) });
			jobRefs.push({ kind: 'merged', group });
		} else {
			for (const meshMeta of group.meshes) {
				jobs.push({ kind: 'single', windows: [windowOf(meshMeta)] });
				jobRefs.push({ kind: 'single', group, meshMeta });
			}
		}
	}

	// The geometry views alias the caller's blob buffer — copy them so the transfer can't detach
	// it. UV/color arrays are parser-owned fresh copies and transfer directly.
	const vertexData = raw.vertexData.slice();
	const indexData = raw.indexData.slice();
	const transfer: Transferable[] = [vertexData.buffer, indexData.buffer];
	if (raw.uvs) transfer.push(raw.uvs.buffer);
	if (raw.colors) transfer.push(raw.colors.buffer);

	let assembled: AssembledGeometry[];
	try {
		assembled = await requestAssembly(
			worker,
			{
				vertexData,
				isFloat32: raw.isFloat32,
				deltaEncoded: raw.deltaEncoded,
				origin: raw.origin,
				scale: raw.scale,
				indexData,
				uvs: raw.uvs,
				colors: raw.colors,
				jobs
			},
			transfer
		);
	} catch (error) {
		getLogger().warn('Mesh assembly worker failed; falling back to main-thread parse.', error);
		return null;
	}
	if (assembled.length !== jobs.length) return null; // defensive: protocol mismatch → sync path

	const materials = materialsSrc.map((m) =>
		createMaterial(m, { vertexColors: raw.colors != null, appearance: opts.material })
	);

	const meshes: THREE.Mesh[] = [];
	for (let i = 0; i < assembled.length; i++) {
		const result = assembled[i]!;
		const ref = jobRefs[i]!;

		let geometry = geometryCacheGet(result.key);
		if (!geometry) {
			geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
			geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
			geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
			if (result.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(result.uvs, 2));
			if (result.colors) {
				geometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3, true));
			}
			geometryCachePut(result.key, geometry);
		}

		const mesh =
			ref.kind === 'merged'
				? finalizeMergedMesh(geometry, ref.group, materials)
				: finalizeSingleMesh(geometry, ref.meshMeta!, ref.group, materials);
		mesh.userData.sourceComponentId = sourceComponentId ?? null;
		meshes.push(mesh);
	}

	if (opts.debug) {
		getLogger().debug(
			`Mesh batch assembled off-thread: ${meshes.length} meshes, ${raw.indexData.length / 3} triangles`
		);
	}
	return meshes;
}

// ============================================================================
// DEBUG HELPERS
// ============================================================================

function approximateBase64DecodedBytes(base64: string): number {
	return Math.floor((base64.length * 3) / 4);
}
