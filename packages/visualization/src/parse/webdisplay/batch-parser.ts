import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import { FLAG_FLOAT32, parseBinaryMeshBatch, parseBinaryMeshBatchRaw } from './binary-parser.js';

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
	finalizeSingleMesh,
	splitGroupByLayer
} from './batch/merge.js';
import { dequantizeInt16, validateGroupMetadata } from './batch/metadata.js';

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
interface ParseTelemetry {
	parseTime?: number;
	perfStart?: number;
}

/**
 * Parses a batched mesh JSON and creates Three.js meshes. The geometry payload is the binary
 * "SLVA" blob produced by the C# `SlvaWriter`, base64-encoded into the outer JSON
 * envelope — `JSON.parse`s the small envelope, then hands the blob to `parseBinaryMeshBatch`
 * without ever turning it into a string.
 *
 * An invalid JSON envelope logs and returns `[]` (genuinely absent data). A corrupt, truncated, or
 * unsupported *blob* throws instead of silently rendering an empty scene.
 *
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
 * Synchronous internally — `parseBinaryMeshBatch` does no IO, just typed-array views over the
 * blob. Stays `async` so callers don't need to change shape if parsing moves into a worker later.
 *
 * @throws {VisualizationError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
 */
export async function parseMeshBatchObject(
	batch: DisplayBatch,
	options?: MeshBatchParsingOptions,
	/** @internal Timings threaded from an outer entry point — not a caller option. */
	telemetry?: ParseTelemetry
): Promise<THREE.Mesh[]> {
	const { mergeByMaterial = true, debug = false, material } = options ?? {};
	const { parseTime = 0, perfStart = debug ? performance.now() : 0 } = telemetry ?? {};

	if (!batch.compressedData) {
		// Items-only or empty batch — the one entry-point path that legitimately yields [] rather
		// than throwing.
		return [];
	}

	// Heavy batches decode+assemble in a worker; null → do it here (small batch or no worker support).
	const workerMeshes = await tryBuildViaWorker(batch.compressedData, {
		mergeByMaterial,
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
 * Use this entry point when the blob arrives as a binary WebSocket frame rather than inside a JSON
 * envelope — the blob is self-describing, with materials, groups, and `sourceComponentId` coming
 * from its embedded metadata header.
 *
 * @throws {VisualizationError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
 */
export async function parseMeshBatchBlob(
	blob: ArrayBuffer | Uint8Array,
	options?: MeshBatchParsingOptions
): Promise<THREE.Mesh[]> {
	const { mergeByMaterial = true, debug = false, material, identityNamespace } = options ?? {};

	const perfStart = debug ? performance.now() : 0;
	const fallback = identityNamespace ? { sourceComponentId: identityNamespace } : undefined;

	// Heavy batches decode+assemble in a worker; null → do it here (small batch or no worker support).
	const workerMeshes = await tryBuildViaWorker(blob, {
		mergeByMaterial,
		debug,
		material,
		fallback
	});
	if (workerMeshes) return workerMeshes;

	const decodeStart = performance.now();
	const parsed = parseBinaryMeshBatch(blob);
	const decodeTime = performance.now() - decodeStart;

	const blobBytes = blob.byteLength;

	return buildMeshesFromParsed(parsed, {
		mergeByMaterial,
		debug,
		material,
		parseTime: 0,
		decodeTime,
		perfStart,
		blobBytes,
		fallback
	});
}

interface BuildOptions {
	mergeByMaterial: boolean;
	debug: boolean;
	material?: MaterialAppearanceOptions;
	parseTime: number;
	decodeTime: number;
	perfStart: number;
	blobBytes: number;
	/** Outer-envelope fallback used when the blob's metadata is missing fields. */
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
	// Envelope sourceComponentId wins over the blob's embedded one: the blob bakes in the id at
	// encode time, but a reloaded part (e.g. a .slvm mesh file instanced many times) re-stamps a fresh id on
	// the envelope so web pick identity stays distinct per placement. The blob value only applies
	// to the raw-blob transport, which has no envelope.
	const sourceComponentId = fallback?.sourceComponentId ?? parsed.metadata.sourceComponentId;

	const isFloat32 = (parsed.flags & FLAG_FLOAT32) !== 0;

	// Group metadata is used arithmetically below — unchecked, a bad vertexStart/indexStart wraps
	// rebased indices into a Uint32Array, `subarray` silently clamps, and an out-of-range
	// materialId feeds `undefined` into `new THREE.Mesh`. Fail the parse instead of corrupting
	// the render silently.
	validateGroupMetadata(
		groups,
		materialsSrc.length,
		parsed.vertices.length / 3,
		parsed.indices.length
	);

	// Dequantize once up front into a single Float32Array — downstream code (per-group merging,
	// computeVertexNormals, ground-offset) expects world-unit floats, and one linear pass over the
	// int16 buffer beats doing it per group.
	const worldVertices = isFloat32
		? (parsed.vertices as Float32Array)
		: dequantizeInt16(parsed.vertices as Int16Array, parsed.origin, parsed.scale);

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
	// Vertex colors are batch-wide when present — meshes without real colors carry a white fill,
	// which multiplies to identity — so the material enables vertexColors unconditionally.
	const materials = materialsSrc.map((m) =>
		createMaterial(m, {
			vertexColors: parsed.colors != null,
			appearance: materialAppearance
		})
	);

	const meshes: THREE.Mesh[] = [];

	// Merge within a layer, never across one: see `splitGroupByLayer`.
	const mergeGroups = mergeByMaterial ? groups.flatMap(splitGroupByLayer) : groups;

	for (const group of mergeGroups) {
		if (mergeByMaterial && group.meshes.length > 1) {
			const mergedMesh = createMergedMesh(
				group,
				worldVertices,
				parsed.indices,
				materials,
				parsed.uvs,
				parsed.colors
			);
			// Left absent when unknown, never null: stable identity tests the field's type to decide
			// whether it can key on the component, and a null would silently demote every mesh of
			// this batch to the weaker name+layer key.
			if (sourceComponentId) mergedMesh.userData.sourceComponentId = sourceComponentId;
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
			if (sourceComponentId) {
				for (const mesh of individualMeshes) {
					mesh.userData.sourceComponentId = sourceComponentId;
				}
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
// OFF-THREAD ASSEMBLY
// ============================================================================

interface WorkerPathOptions {
	mergeByMaterial: boolean;
	debug: boolean;
	material?: MaterialAppearanceOptions;
	fallback?: BuildOptions['fallback'];
}

/**
 * Attempts the off-thread build. Returns the finished meshes, or `null` when the worker path
 * doesn't apply (no Worker, small batch, worker crashed) — the caller then runs the synchronous
 * path. Malformed-blob/metadata errors throw either way, matching the entry points' contract.
 *
 * The worker always assembles and fingerprints every geometry, even when the main thread ends up
 * preferring an existing cached geometry over the returned buffers. That's fine: cache hits skip
 * the GPU re-upload, so the wasted worker CPU is off the critical path by definition.
 */
async function tryBuildViaWorker(
	input: ArrayBuffer | Uint8Array | string,
	opts: WorkerPathOptions
): Promise<THREE.Mesh[] | null> {
	if (typeof Worker === 'undefined') return null;

	const raw = parseBinaryMeshBatchRaw(input);
	// Planar (v4) indexData is a bare byte stream — divide by the element width for a count.
	const indexCount = raw.planarByteSplit
		? raw.indexData.length / (raw.uint16Indices ? 2 : 4)
		: raw.indexData.length;
	if (indexCount / 3 < ASSEMBLY_WORKER_MIN_TRIANGLES) return null;
	const worker = getAssemblyWorker();
	if (!worker) return null;

	const materialsSrc = raw.metadata.materials ?? opts.fallback?.materials ?? [];
	const groups = raw.metadata.groups ?? opts.fallback?.groups ?? [];
	const sourceComponentId = opts.fallback?.sourceComponentId ?? raw.metadata.sourceComponentId;
	validateGroupMetadata(groups, materialsSrc.length, raw.vertexCount, indexCount);

	// Same job branching as buildMeshesFromParsed, with a parallel ref list to unwrap results by index.
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
	// Same layer-aware merge grouping as the synchronous path.
	const mergeGroups = opts.mergeByMaterial ? groups.flatMap(splitGroupByLayer) : groups;
	for (const group of mergeGroups) {
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

	// vertexData/indexData alias the caller's blob buffer — copy before transferring so the
	// transfer can't detach it. UV/color arrays are already fresh copies and transfer directly.
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
				planarByteSplit: raw.planarByteSplit,
				uint16Indices: raw.uint16Indices,
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
	if (assembled.length !== jobs.length) return null; // protocol mismatch → fall back to sync path

	const materials = materialsSrc.map((m) =>
		createMaterial(m, { vertexColors: raw.colors != null, appearance: opts.material })
	);

	const meshes: THREE.Mesh[] = [];
	for (let i = 0; i < assembled.length; i++) {
		const result = assembled[i]!;
		const ref = jobRefs[i]!;

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
		geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
		if (result.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(result.uvs, 2));
		if (result.colors) {
			geometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3, true));
		}

		const mesh =
			ref.kind === 'merged'
				? finalizeMergedMesh(geometry, ref.group, materials)
				: finalizeSingleMesh(geometry, ref.meshMeta!, ref.group, materials);
		if (sourceComponentId) mesh.userData.sourceComponentId = sourceComponentId;
		meshes.push(mesh);
	}

	if (opts.debug) {
		getLogger().debug(
			`Mesh batch assembled off-thread: ${meshes.length} meshes, ${indexCount / 3} triangles`
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
