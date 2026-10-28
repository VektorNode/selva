import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

import { decodeRawMeshBatch, FLAG_FLOAT32, parseBinaryMeshBatchRaw } from './binary-parser.js';
import { inflateSlvzAsync, slvzInflatedBytes, toUint8Array } from './binary/geometry.js';
import { isSlvmContainer, parseSlvmContainer, type SlvmContainer } from './binary/slvm.js';
import { assembleGeometries, finishGeometry } from './mesh-assembly.js';

import {
	ASSEMBLY_WORKER_MIN_TRIANGLES,
	getAssemblyWorker,
	requestAssembly
} from './batch/assembly-worker.js';
import { createMaterialPicker } from './batch/materials.js';
import {
	createIndividualMeshes,
	createMergedMesh,
	finalizeMergedMesh,
	finalizeSingleMesh,
	mergeGroupsOf
} from './batch/merge.js';
import {
	buildBatch,
	getFinishedBatch,
	storeFinishedBatch,
	type BuiltBatch,
	type FinishedBatch
} from './batch/finished-cache.js';
import { dequantizeInt16, validateGroupMetadata } from './batch/metadata.js';

import type { AssemblyJob, AssemblyWindow, FinishedGeometry } from './mesh-assembly.js';
import type { ParsedBinaryMeshBatch, RawBinaryMeshBatch } from './binary-parser.js';
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

	const decodeStart = performance.now();
	const assemblyOptions: AssemblyPathOptions = {
		mergeByMaterial,
		debug,
		material,
		fallback: {
			materials: batch.materials,
			groups: batch.groups
		}
	};
	const opened = await openBatch(batch.compressedData, assemblyOptions);
	if (opened.meshes) return opened.meshes;

	// Heavy batches decode+assemble in a worker; null → do it here (small batch).
	const assembledMeshes = await tryBuildViaAssembly(opened, assemblyOptions);
	if (assembledMeshes) return assembledMeshes;

	const parsed = decodeRawMeshBatch(opened.raw);
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
			groups: batch.groups
		}
	});
}

/**
 * Parses a raw binary mesh batch blob (SLVA wire format) and creates Three.js meshes.
 *
 * Use this entry point when the blob arrives as a binary WebSocket frame rather than inside a JSON
 * envelope — the blob is self-describing, with materials, groups, and per-object ids coming
 * from the container's table.
 *
 * @throws {VisualizationError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
 */
export async function parseMeshBatchBlob(
	blob: ArrayBuffer | Uint8Array,
	options?: MeshBatchParsingOptions
): Promise<THREE.Mesh[]> {
	const { mergeByMaterial = true, debug = false, material } = options ?? {};

	const perfStart = debug ? performance.now() : 0;

	const decodeStart = performance.now();
	const assemblyOptions: AssemblyPathOptions = { mergeByMaterial, debug, material };
	const opened = await openBatch(blob, assemblyOptions);
	if (opened.meshes) return opened.meshes;

	// Heavy batches decode+assemble in a worker; null → do it here (small batch).
	const assembledMeshes = await tryBuildViaAssembly(opened, assemblyOptions);
	if (assembledMeshes) return assembledMeshes;

	const parsed = decodeRawMeshBatch(opened.raw);
	const decodeTime = performance.now() - decodeStart;

	const blobBytes = blob.byteLength;

	return buildMeshesFromParsed(parsed, {
		mergeByMaterial,
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
	};
}

// Past this many source meshes, one THREE object each is the difference between a viewer that
// holds 60fps and one that does not: render cost tracks object count, not triangles, and every
// object also pays for its own edge overlay. A batch this size is an imported building model, where
// merging is the only thing that keeps it interactive.
const UNMERGED_MESH_WARN_THRESHOLD = 1_000;

let warnedUnmerged = false;

/** @internal Test seam: the warn-once flag is module state and would leak between cases. */
export function resetUnmergedWarning(): void {
	warnedUnmerged = false;
}

/**
 * Warns once when a caller opts out of merging on a batch large enough for it to hurt.
 *
 * Opting out is legitimate — it is what gives every source object its own THREE object — so this
 * does not override the caller. It exists because the failure is silent: nothing errors, the model
 * renders correctly, and the only symptom is a frame rate nobody traces back to a parse option.
 */
function warnIfUnmergedAtScale(mergeByMaterial: boolean, groups: MaterialGroup[]): void {
	if (mergeByMaterial || warnedUnmerged) return;

	let meshCount = 0;
	for (const group of groups) meshCount += group.meshes.length;
	if (meshCount < UNMERGED_MESH_WARN_THRESHOLD) return;

	warnedUnmerged = true;
	getLogger().warn(
		`Parsing ${meshCount} meshes with mergeByMaterial: false — each becomes its own THREE ` +
			`object, and render cost scales with object count. Drop the option to merge by material ` +
			`(the default); per-object identity survives it via userData.members.`
	);
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

	warnIfUnmergedAtScale(mergeByMaterial, groups);

	const meshCreateStart = performance.now();
	// Vertex colors are batch-wide when present — meshes without real colors carry a white fill,
	// which multiplies to identity — so the material enables vertexColors unconditionally.
	const pickMaterial = createMaterialPicker(materialsSrc, {
		vertexColors: parsed.colors != null,
		hasUvs: parsed.uvs != null,
		appearance: materialAppearance
	});

	const meshes: THREE.Mesh[] = [];

	const mergeGroups = mergeByMaterial ? mergeGroupsOf(groups) : groups;

	for (const group of mergeGroups) {
		if (mergeByMaterial && group.meshes.length > 1) {
			const mergedMesh = createMergedMesh(
				group,
				worldVertices,
				parsed.indices,
				pickMaterial,
				parsed.uvs,
				parsed.colors
			);
			meshes.push(mergedMesh);
		} else {
			const individualMeshes = createIndividualMeshes(
				group,
				worldVertices,
				parsed.indices,
				pickMaterial,
				parsed.uvs,
				parsed.colors
			);
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
// ASSEMBLY PATH: worker or inline, cached by geometry bytes
// ============================================================================

interface AssemblyPathOptions {
	mergeByMaterial: boolean;
	debug: boolean;
	material?: MaterialAppearanceOptions;
	fallback?: BuildOptions['fallback'];
}

interface JobRef {
	kind: 'merged' | 'single';
	group: MaterialGroup;
	meshMeta?: MeshMetadata;
}

interface OpenedGeometry {
	meshes?: never;
	raw: RawBinaryMeshBatch;
	/** The geometry chunk of an SLVM container: the finished-cache key. Null for a bare blob. */
	geometryBytes: Uint8Array | null;
	/** The bytes `raw` was parsed from, whose buffer `raw`'s arrays may still alias. */
	source: Uint8Array;
	/** Parses `source` again, for when `raw`'s arrays were transferred away. */
	reparse: () => RawBinaryMeshBatch;
}

type OpenedBatch = { meshes: THREE.Mesh[]; raw?: never } | OpenedGeometry;

/**
 * Unwraps an SLVM container only as far as its table and materials, and answers from the
 * finished-geometry cache before paying for the inflate. A bare SLVA/SLVZ blob (old `.gh` files)
 * keeps its metadata inside the compressed geometry, so it always decodes.
 */
async function openBatch(
	input: ArrayBuffer | Uint8Array | string,
	opts: AssemblyPathOptions
): Promise<OpenedBatch> {
	const bytes = toUint8Array(input);
	if (!isSlvmContainer(bytes)) {
		return {
			raw: parseBinaryMeshBatchRaw(bytes),
			geometryBytes: null,
			source: bytes,
			reparse: () => parseBinaryMeshBatchRaw(bytes)
		};
	}

	const container = parseSlvmContainer(bytes);
	const cached = buildFromFinishedCache(container, opts);
	if (cached) return { meshes: cached };

	const geometryBlob = container.geometryBlob;
	const reparse = (): RawBinaryMeshBatch => {
		const raw = parseBinaryMeshBatchRaw(geometryBlob);
		raw.metadata = container.metadata;
		return raw;
	};
	const inflated = await inflateInWorker(container);
	const raw = inflated ? parseBinaryMeshBatchRaw(inflated) : reparse();
	raw.metadata = container.metadata;
	return { raw, geometryBytes: geometryBlob, source: geometryBlob, reparse };
}

// Below this the inflate takes under ~6 ms, less than the hop to a second worker costs.
const INFLATE_IN_WORKER_MIN_BYTES = 4 * 1024 * 1024;

/**
 * Inflates a large SLVZ geometry chunk off the calling thread. Null means inflate it here: a small
 * or uncompressed chunk, no worker support, or a worker that failed.
 */
async function inflateInWorker(container: SlvmContainer): Promise<Uint8Array | null> {
	if (
		slvzInflatedBytes(container.geometryBlob) < INFLATE_IN_WORKER_MIN_BYTES ||
		!getAssemblyWorker()
	) {
		return null;
	}
	try {
		return await inflateSlvzAsync(container.geometryBlob);
	} catch {
		return null;
	}
}

function buildFromFinishedCache(
	container: SlvmContainer,
	opts: AssemblyPathOptions
): THREE.Mesh[] | null {
	const materialsSrc = container.metadata.materials ?? opts.fallback?.materials ?? [];
	const groups = container.metadata.groups ?? opts.fallback?.groups ?? [];
	const { jobs, jobRefs } = planJobs(groups, opts.mergeByMaterial);
	const cached = getFinishedBatch(container.geometryBlob, jobs);
	if (!cached) return null;

	// Equal jobs mean equal windows, but the material ids are this batch's own.
	validateGroupMetadata(groups, materialsSrc.length, cached.vertexCount, cached.indexCount);
	return meshesFromBuilt(cached, jobRefs, materialsSrc, opts.material);
}

/** One job per merged group or per unmerged mesh, with a parallel ref list to unwrap results by index. */
function planJobs(
	groups: MaterialGroup[],
	mergeByMaterial: boolean
): { jobs: AssemblyJob[]; jobRefs: JobRef[] } {
	const windowOf = (m: MeshMetadata): AssemblyWindow => ({
		vertexStart: m.vertexStart,
		vertexCount: m.vertexCount,
		indexStart: m.indexStart,
		indexCount: m.indexCount
	});
	const jobs: AssemblyJob[] = [];
	const jobRefs: JobRef[] = [];
	// Same layer-aware merge grouping as the synchronous path.
	const mergeGroups = mergeByMaterial ? mergeGroupsOf(groups) : groups;
	for (const group of mergeGroups) {
		if (mergeByMaterial && group.meshes.length > 1) {
			jobs.push({ kind: 'merged', windows: group.meshes.map(windowOf) });
			jobRefs.push({ kind: 'merged', group });
		} else {
			for (const meshMeta of group.meshes) {
				jobs.push({ kind: 'single', windows: [windowOf(meshMeta)] });
				jobRefs.push({ kind: 'single', group, meshMeta });
			}
		}
	}
	return { jobs, jobRefs };
}

/**
 * Builds a heavy batch through the assembly functions, in the worker when there is one and inline
 * otherwise, and caches the result under `geometryBytes`. Returns `null` for a small batch or a
 * crashed worker, and the caller then runs the synchronous path. Malformed-blob/metadata errors
 * throw either way, matching the entry points' contract.
 */
async function tryBuildViaAssembly(
	opened: OpenedGeometry,
	opts: AssemblyPathOptions
): Promise<THREE.Mesh[] | null> {
	const { raw, geometryBytes } = opened;
	// Planar (v4) indexData is a bare byte stream — divide by the element width for a count.
	const indexCount = raw.planarByteSplit
		? raw.indexData.length / (raw.uint16Indices ? 2 : 4)
		: raw.indexData.length;
	if (indexCount / 3 < ASSEMBLY_WORKER_MIN_TRIANGLES) return null;

	const materialsSrc = raw.metadata.materials ?? opts.fallback?.materials ?? [];
	const groups = raw.metadata.groups ?? opts.fallback?.groups ?? [];
	validateGroupMetadata(groups, materialsSrc.length, raw.vertexCount, indexCount);

	const { jobs, jobRefs } = planJobs(groups, opts.mergeByMaterial);
	const assembled = await assemble(raw, jobs, opened.source);
	if (!assembled) {
		// A worker that failed already took the arrays: `decodeRawMeshBatch` needs fresh ones.
		if (ownsBuffer(raw, opened.source)) opened.raw = opened.reparse();
		return null;
	}

	const batch: FinishedBatch = {
		geometries: assembled,
		hasUvs: raw.uvs != null,
		hasColors: raw.colors != null,
		vertexCount: raw.vertexCount,
		indexCount
	};
	const built = geometryBytes ? storeFinishedBatch(geometryBytes, jobs, batch) : buildBatch(batch);

	if (opts.debug) {
		getLogger().debug(
			`Mesh batch assembled: ${assembled.length} geometries, ${indexCount / 3} triangles`
		);
	}
	return meshesFromBuilt(built, jobRefs, materialsSrc, opts.material);
}

/**
 * True when `raw`'s geometry arrays live in a buffer nobody else reads: the buffer a SLVZ chunk
 * was inflated into, not the WebSocket frame an uncompressed chunk still points into.
 */
function ownsBuffer(raw: RawBinaryMeshBatch, source: Uint8Array): boolean {
	return raw.vertexData.buffer !== source.buffer && raw.indexData.buffer !== source.buffer;
}

async function assemble(
	raw: RawBinaryMeshBatch,
	jobs: AssemblyJob[],
	source: Uint8Array
): Promise<FinishedGeometry[] | null> {
	const worker = getAssemblyWorker();
	const input = {
		vertexData: raw.vertexData,
		isFloat32: raw.isFloat32,
		deltaEncoded: raw.deltaEncoded,
		planarByteSplit: raw.planarByteSplit,
		uint16Indices: raw.uint16Indices,
		origin: raw.origin,
		scale: raw.scale,
		indexData: raw.indexData,
		uvs: raw.uvs,
		colors: raw.colors,
		jobs
	};

	if (!worker) {
		return assembleGeometries(input).map((geometry, i) =>
			finishGeometry(
				geometry,
				jobs[i]!.windows.map((w) => w.indexCount)
			)
		);
	}

	// Transferring detaches. An inflated buffer is ours to give away; an uncompressed chunk's arrays
	// alias the WebSocket frame, which the finished cache still reads afterwards, so those are copied.
	if (!ownsBuffer(raw, source)) {
		input.vertexData = raw.vertexData.slice();
		input.indexData = raw.indexData.slice();
		input.uvs = raw.uvs?.slice() ?? null;
		input.colors = raw.colors?.slice() ?? null;
	}

	const transfer = new Set<ArrayBufferLike>([input.vertexData.buffer, input.indexData.buffer]);
	if (input.uvs) transfer.add(input.uvs.buffer);
	if (input.colors) transfer.add(input.colors.buffer);
	try {
		const assembled = await requestAssembly(worker, input, [...transfer] as Transferable[]);
		return assembled.length === jobs.length ? assembled : null; // protocol mismatch → sync path
	} catch (error) {
		getLogger().warn('Mesh assembly worker failed; falling back to main-thread parse.', error);
		return null;
	}
}

function meshesFromBuilt(
	built: BuiltBatch,
	jobRefs: JobRef[],
	materialsSrc: SerializableMaterial[],
	appearance: MaterialAppearanceOptions | undefined
): THREE.Mesh[] {
	const pickMaterial = createMaterialPicker(materialsSrc, {
		vertexColors: built.hasColors,
		hasUvs: built.hasUvs,
		appearance
	});

	const meshes: THREE.Mesh[] = [];
	for (let i = 0; i < built.buffers.length; i++) {
		const geometry = built.buffers[i]!;
		const ref = jobRefs[i]!;
		const material = pickMaterial(ref.group.materialId, built.closed[i]!);
		const mesh =
			ref.kind === 'merged'
				? finalizeMergedMesh(geometry, ref.group, material)
				: finalizeSingleMesh(geometry, ref.meshMeta!, material);
		meshes.push(mesh);
	}
	return meshes;
}

// ============================================================================
// DEBUG HELPERS
// ============================================================================

function approximateBase64DecodedBytes(base64: string): number {
	return Math.floor((base64.length * 3) / 4);
}
