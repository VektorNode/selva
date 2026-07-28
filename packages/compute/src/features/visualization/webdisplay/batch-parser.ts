import * as THREE from 'three';

import { parseColor } from '../threejs/three-helpers.js';
import { getLogger } from '@/core';
import { RhinoComputeError, ErrorCodes } from '@/core/errors';

import { FLAG_FLOAT32, parseBinaryMeshBatch, parseBinaryMeshBatchRaw } from './binary-parser.js';
import { fingerprintViews, geometryCacheGet, geometryCachePut } from './geometry-cache.js';
import { meshAssemblyWorkerSource } from './mesh-assembly.js';
import { applyTextureMap } from './texture-cache.js';

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
 * @throws {RhinoComputeError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
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
 * @throws {RhinoComputeError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
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
 * @throws {RhinoComputeError} On a corrupt/truncated/unsupported mesh blob or malformed group metadata.
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

function metadataFail(message: string, context: Record<string, unknown>): RhinoComputeError {
	return new RhinoComputeError(message, ErrorCodes.VALIDATION_ERROR, { context });
}

/**
 * Validates the batch's group/mesh metadata against the decoded geometry buffers before any of it
 * is used arithmetically. Throws a VALIDATION_ERROR on the first inconsistency (out-of-range
 * `materialId`, non-integer or negative offsets/counts, or vertex/index windows that overrun the
 * buffers) so malformed or version-skewed metadata fails the parse loudly.
 */
function validateGroupMetadata(
	groups: MaterialGroup[],
	materialCount: number,
	totalVertexCount: number,
	totalIndexCount: number
): void {
	for (const group of groups) {
		if (
			!Number.isInteger(group.materialId) ||
			group.materialId < 0 ||
			group.materialId >= materialCount
		) {
			throw metadataFail('Group materialId out of range of the materials array.', {
				materialId: group.materialId,
				materialCount
			});
		}

		for (const mesh of group.meshes) {
			const fields = {
				vertexStart: mesh.vertexStart,
				vertexCount: mesh.vertexCount,
				indexStart: mesh.indexStart,
				indexCount: mesh.indexCount
			};
			for (const [field, value] of Object.entries(fields)) {
				if (!Number.isInteger(value) || value < 0) {
					throw metadataFail(`Mesh metadata field "${field}" must be a non-negative integer.`, {
						meshName: mesh.name,
						field,
						value
					});
				}
			}

			if (mesh.vertexStart + mesh.vertexCount > totalVertexCount) {
				throw metadataFail('Mesh vertex window exceeds the batch vertex buffer.', {
					meshName: mesh.name,
					vertexStart: mesh.vertexStart,
					vertexCount: mesh.vertexCount,
					totalVertexCount
				});
			}

			if (mesh.indexStart + mesh.indexCount > totalIndexCount) {
				throw metadataFail('Mesh index window exceeds the batch index buffer.', {
					meshName: mesh.name,
					indexStart: mesh.indexStart,
					indexCount: mesh.indexCount,
					totalIndexCount
				});
			}
		}
	}
}

/**
 * Error for an index outside its mesh's declared vertex window
 * `[vertexStart, vertexStart + vertexCount)`. Rebasing (`index - vertexStart`) writes into an
 * unsigned array, so a violation would otherwise wrap to ~4 billion and corrupt the geometry.
 * The range checks themselves are inlined in the copy loops (audit P6 — a function call per index
 * was measurable at millions of indices); this only builds the failure.
 */
function indexOutOfWindow(indexValue: number, meshMeta: MeshMetadata): RhinoComputeError {
	return metadataFail("Index references a vertex outside its mesh's vertex window.", {
		meshName: meshMeta.name,
		indexValue,
		vertexStart: meshMeta.vertexStart,
		vertexCount: meshMeta.vertexCount
	});
}

/**
 * Content key for the cross-solve geometry cache: samples of every buffer window this geometry is
 * built from, plus the window layout as salt (identical bytes at a different offset rebase to
 * different geometry). See geometry-cache.ts for the safety model.
 */
function geometryContentKey(
	kind: 'merged' | 'single',
	meshes: MeshMetadata[],
	allVertices: Float32Array,
	allIndices: Uint16Array | Uint32Array,
	allUvs: Float32Array | null,
	allColors: Uint8Array | null
): string {
	const parts: (ArrayBufferView | null)[] = [];
	let salt = kind;
	for (const meshMeta of meshes) {
		salt += `|${meshMeta.vertexStart},${meshMeta.vertexCount},${meshMeta.indexStart},${meshMeta.indexCount}`;
		const componentStart = meshMeta.vertexStart * 3;
		const componentEnd = componentStart + meshMeta.vertexCount * 3;
		parts.push(allVertices.subarray(componentStart, componentEnd));
		parts.push(allIndices.subarray(meshMeta.indexStart, meshMeta.indexStart + meshMeta.indexCount));
		parts.push(
			allUvs
				? allUvs.subarray(
						meshMeta.vertexStart * 2,
						(meshMeta.vertexStart + meshMeta.vertexCount) * 2
					)
				: null
		);
		parts.push(allColors ? allColors.subarray(componentStart, componentEnd) : null);
	}
	return fingerprintViews(parts, salt);
}

/**
 * Reconstructs world-unit float32 positions from int16 quantized values.
 *
 * Mirrors the encoder formula: `world = origin + (q + 32767) * scale`. Selva keeps one coordinate
 * frame end to end (the Three scene is Rhino's Z-up frame — see `../coordinate-transform.ts`), so
 * vertices pass through unrotated. `_applyCoordinateTransform` is retained for call-site
 * compatibility and no longer changes the output.
 */
function dequantizeInt16(
	q: Int16Array,
	origin: [number, number, number],
	scale: [number, number, number],
	_applyCoordinateTransform: boolean
): Float32Array {
	const out = new Float32Array(q.length);
	const ox = origin[0];
	const oy = origin[1];
	const oz = origin[2];
	const sx = scale[0];
	const sy = scale[1];
	const sz = scale[2];

	for (let i = 0; i < q.length; i += 3) {
		out[i] = ox + (q[i]! + 32767) * sx;
		out[i + 1] = oy + (q[i + 1]! + 32767) * sy;
		out[i + 2] = oz + (q[i + 2]! + 32767) * sz;
	}

	return out;
}

/**
 * For float32 batches the parser's view is already in the scene frame (Rhino Z-up), so we pass it
 * through without copying. `_applyCoordinateTransform` is retained for call-site compatibility and
 * no longer rotates.
 */
function maybeRotateFloat32Vertices(
	vertices: Float32Array,
	_applyCoordinateTransform: boolean
): Float32Array {
	return vertices;
}

// ============================================================================
// OFF-THREAD ASSEMBLY (audit P2 — docs/plans/5.display-pipeline-performance-audit.md)
// ============================================================================

/**
 * Below this triangle count the synchronous path finishes in ~10 ms — a worker round-trip (two
 * buffer copies + wake) isn't worth it. Above it, delta-decode + dequantize + merge + normals run
 * in the worker and the main thread only wraps returned buffers (or reuses cached geometries).
 */
const ASSEMBLY_WORKER_MIN_TRIANGLES = 50_000;

interface PendingAssembly {
	resolve: (geometries: AssembledGeometry[]) => void;
	reject: (error: Error) => void;
}

let assemblyWorker: Worker | null | undefined; // undefined = not yet tried, null = unavailable
const pendingAssemblies = new Map<number, PendingAssembly>();
let nextAssemblyRequestId = 1;

function getAssemblyWorker(): Worker | null {
	if (assemblyWorker !== undefined) return assemblyWorker;
	if (
		typeof Worker === 'undefined' ||
		typeof Blob === 'undefined' ||
		typeof URL === 'undefined' ||
		typeof URL.createObjectURL !== 'function'
	) {
		assemblyWorker = null;
		return null;
	}
	try {
		// Blob URL keeps the library bundler-agnostic; deliberately never revoked (see edges.ts).
		const url = URL.createObjectURL(
			new Blob([meshAssemblyWorkerSource()], { type: 'text/javascript' })
		);
		const worker = new Worker(url);
		worker.onmessage = (event: MessageEvent) => {
			const { id, geometries, error } = event.data as {
				id: number;
				geometries?: AssembledGeometry[];
				error?: string;
			};
			const pending = pendingAssemblies.get(id);
			if (!pending) return;
			pendingAssemblies.delete(id);
			if (geometries) pending.resolve(geometries);
			else pending.reject(new Error(error ?? 'mesh assembly failed in worker'));
		};
		worker.onerror = () => {
			for (const pending of pendingAssemblies.values()) {
				pending.reject(new Error('mesh assembly worker crashed'));
			}
			pendingAssemblies.clear();
			worker.terminate();
			assemblyWorker = null; // don't retry this session — callers fall back to the sync path
		};
		assemblyWorker = worker;
	} catch {
		assemblyWorker = null;
	}
	return assemblyWorker;
}

function requestAssembly(
	worker: Worker,
	input: unknown,
	transfer: Transferable[]
): Promise<AssembledGeometry[]> {
	return new Promise<AssembledGeometry[]>((resolve, reject) => {
		const id = nextAssemblyRequestId++;
		pendingAssemblies.set(id, { resolve, reject });
		worker.postMessage({ id, input }, transfer);
	});
}

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
// MATERIAL CONSTRUCTION
// ============================================================================

// A near-pure metal has no diffuse response, so under the low-IBL 'technical' look it goes flat and
// reads as painted card. Real architectural sheet metal is coated, not a bare mirror — so materials
// that are meaningfully metallic get a thin satin clearcoat: a glossy dielectric layer whose
// highlight and environment response are independent of the base metalness/envMap, so folds catch
// light even when the IBL is dialed down. Below this metalness the material is treated as
// plastic/matte and left untouched.
const METAL_CLEARCOAT_THRESHOLD = 0.5;
const METAL_CLEARCOAT = 0.5;
const METAL_CLEARCOAT_ROUGHNESS = 0.3;

function createMaterial(
	matData: SerializableMaterial,
	options?: { vertexColors?: boolean; appearance?: MaterialAppearanceOptions }
): THREE.MeshPhysicalMaterial {
	const color = parseColor(matData.color);
	const vertexColors = options?.vertexColors ?? false;
	const appearance = options?.appearance;

	const material = new THREE.MeshPhysicalMaterial({
		color,
		metalness: matData.metalness,
		roughness: matData.roughness,
		opacity: matData.opacity,
		transparent: matData.transparent,
		vertexColors,
		// Cull back faces for closed solids (crisper silhouette, less overdraw); keep both sides for
		// open surfaces. Caller-controlled since Rhino emits both — default DoubleSide is the safe read.
		side: appearance?.cullBackfaces ? THREE.FrontSide : THREE.DoubleSide,
		// Reduced polygon offset to minimize artifacts
		// Only use minimal offset to prevent z-fighting on coplanar faces
		polygonOffset: true,
		polygonOffsetFactor: 0.5,
		polygonOffsetUnits: 0.5,
		// Improve depth rendering
		depthWrite: true,
		depthTest: true
	});

	// HDR image-based-lighting reflection strength. Left at three's default (1) unless the caller
	// dials it: <1 flattens reflections toward a matte/technical read, >1 pushes a glossier look.
	if (appearance?.envMapIntensity != null) {
		material.envMapIntensity = appearance.envMapIntensity;
	}

	// Metals get a satin clearcoat so coated sheet metal reads as coated, not flat, under low IBL
	// (see the constants above). Plastics/matte fall below the threshold and stay bare.
	if (matData.metalness > METAL_CLEARCOAT_THRESHOLD) {
		material.clearcoat = METAL_CLEARCOAT;
		material.clearcoatRoughness = METAL_CLEARCOAT_ROUGHNESS;
	}

	// Vertex colors arrive as raw sRGB bytes, but three's vertex-color path multiplies them into the
	// (linear) working space with no decode — so they render washed out. Patch the vertex shader to
	// sRGB→linear decode `color` before use. Only meshes with real vertex colors take this path.
	if (vertexColors) {
		applyVertexColorSRGBDecode(material);
	}

	// Texture loading is async (image decode); the cache assigns `material.map` when ready and
	// flags needsUpdate, so the mesh renders untextured for at most the first frames. Hash-keyed
	// asset URLs are immutable, so each texture is fetched and decoded once per session.
	if (matData.map) {
		applyTextureMap(material, matData.map);
	}

	return material;
}

/**
 * Patch a material's vertex shader to decode its per-vertex `color` attribute from sRGB to linear.
 * three.js uploads vertex colors verbatim and its `color_vertex` chunk multiplies them straight into
 * the linear working color space (unlike textures, which carry a `colorSpace` and get decoded) — so
 * sRGB-authored vertex colors render too bright without this. Done in the shader (not a CPU pass over
 * the buffer) to keep the hot per-solve parse cheap; the decode is a handful of GPU ops per vertex.
 */
function applyVertexColorSRGBDecode(material: THREE.Material): void {
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			'#include <color_vertex>',
			`#include <color_vertex>
			#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
				vColor.rgb = mix(
					vColor.rgb / 12.92,
					pow( ( vColor.rgb + 0.055 ) / 1.055, vec3( 2.4 ) ),
					step( vec3( 0.04045 ), vColor.rgb )
				);
			#endif`
		);
	};
}

// ============================================================================
// MESH CONSTRUCTION
// ============================================================================

/**
 * Creates a merged mesh from multiple meshes sharing the same material.
 *
 * Indices in the parser output already reference offsets into the combined vertex array (the C#
 * pipeline rebases per-mesh local indices into combined-array indices when assembling the batch).
 * For merged meshes we copy the relevant slices into a fresh contiguous buffer and shift indices
 * to match the new layout.
 */
function createMergedMesh(
	group: MaterialGroup,
	allVertices: Float32Array,
	allIndices: Uint16Array | Uint32Array,
	materials: THREE.Material[],
	allUvs: Float32Array | null = null,
	allColors: Uint8Array | null = null
): THREE.Mesh {
	// Cross-solve reuse (audit P1): identical content → same BufferGeometry object, skipping the
	// merge copies, computeVertexNormals, and the GPU re-upload entirely.
	const cacheKey = geometryContentKey(
		'merged',
		group.meshes,
		allVertices,
		allIndices,
		allUvs,
		allColors
	);
	let geometry = geometryCacheGet(cacheKey);

	if (!geometry) {
		let totalVertexCount = 0;
		let totalIndexCount = 0;
		for (const meshMeta of group.meshes) {
			totalVertexCount += meshMeta.vertexCount;
			totalIndexCount += meshMeta.indexCount;
		}

		const mergedVertices = new Float32Array(totalVertexCount * 3);
		const mergedIndices = new Uint32Array(totalIndexCount);
		const mergedUvs = allUvs ? new Float32Array(totalVertexCount * 2) : null;
		const mergedColors = allColors ? new Uint8Array(totalVertexCount * 3) : null;

		let vertexWriteCursor = 0;
		let indexWriteCursor = 0;

		for (const meshMeta of group.meshes) {
			const componentStart = meshMeta.vertexStart * 3;
			const componentLen = meshMeta.vertexCount * 3;
			mergedVertices.set(
				allVertices.subarray(componentStart, componentStart + componentLen),
				vertexWriteCursor * 3
			);

			if (mergedUvs && allUvs) {
				const uvStart = meshMeta.vertexStart * 2;
				mergedUvs.set(
					allUvs.subarray(uvStart, uvStart + meshMeta.vertexCount * 2),
					vertexWriteCursor * 2
				);
			}

			if (mergedColors && allColors) {
				mergedColors.set(
					allColors.subarray(componentStart, componentStart + componentLen),
					vertexWriteCursor * 3
				);
			}

			const indicesSlice = allIndices.subarray(
				meshMeta.indexStart,
				meshMeta.indexStart + meshMeta.indexCount
			);
			const indexShift = vertexWriteCursor - meshMeta.vertexStart;
			const windowStart = meshMeta.vertexStart;
			const windowEnd = meshMeta.vertexStart + meshMeta.vertexCount;
			for (let i = 0; i < indicesSlice.length; i++) {
				const indexValue = indicesSlice[i]!;
				if (indexValue < windowStart || indexValue >= windowEnd) {
					throw indexOutOfWindow(indexValue, meshMeta);
				}
				mergedIndices[indexWriteCursor + i] = indexValue + indexShift;
			}

			vertexWriteCursor += meshMeta.vertexCount;
			indexWriteCursor += meshMeta.indexCount;
		}

		geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(mergedVertices, 3));
		geometry.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
		if (mergedUvs) {
			geometry.setAttribute('uv', new THREE.BufferAttribute(mergedUvs, 2));
		}
		if (mergedColors) {
			geometry.setAttribute('color', new THREE.BufferAttribute(mergedColors, 3, true));
		}
		geometry.computeVertexNormals();
		geometryCachePut(cacheKey, geometry);
	}

	return finalizeMergedMesh(geometry, group, materials);
}

/** Wraps a merged group's geometry (built or cache-hit) in its THREE.Mesh with identity/userData. */
function finalizeMergedMesh(
	geometry: THREE.BufferGeometry,
	group: MaterialGroup,
	materials: THREE.Material[]
): THREE.Mesh {
	const threeMesh = new THREE.Mesh(geometry, materials[group.materialId]);
	const firstMesh = group.meshes[0];
	const meshNames = group.meshes.map((m) => m.name).filter((name) => name && name.length > 0);
	threeMesh.name = meshNames.length > 0 ? meshNames[0]! : `merged_material_${group.materialId}`;
	threeMesh.castShadow = true;
	threeMesh.receiveShadow = true;

	threeMesh.userData = {
		source: 'compute',
		name: threeMesh.name,
		layer: firstMesh?.layer ?? '',
		originalIndex: firstMesh?.originalIndex ?? 0,
		metadata: firstMesh?.metadata ?? {},
		mergedFrom: group.meshes.slice(1).map((m) => ({
			name: m.name,
			layer: m.layer,
			originalIndex: m.originalIndex
		}))
	};

	return threeMesh;
}

/**
 * Creates individual meshes from a material group. Each mesh's indices are rebased so they
 * address its own local vertex slice starting from 0.
 */
function createIndividualMeshes(
	group: MaterialGroup,
	allVertices: Float32Array,
	allIndices: Uint16Array | Uint32Array,
	materials: THREE.Material[],
	allUvs: Float32Array | null = null,
	allColors: Uint8Array | null = null
): THREE.Mesh[] {
	const meshes: THREE.Mesh[] = [];

	for (const meshMeta of group.meshes) {
		const componentStart = meshMeta.vertexStart * 3;
		const componentLen = meshMeta.vertexCount * 3;

		// Cross-solve reuse (audit P1) — see createMergedMesh.
		const cacheKey = geometryContentKey(
			'single',
			[meshMeta],
			allVertices,
			allIndices,
			allUvs,
			allColors
		);
		let geometry = geometryCacheGet(cacheKey);

		if (!geometry) {
			// `subarray` returns a view; copy via `slice` so the BufferAttribute owns its memory and
			// downstream code (dispose/reuse) can't surprise us by sharing the parser's buffer.
			const vertices = allVertices.slice(componentStart, componentStart + componentLen);

			const indicesSlice = allIndices.subarray(
				meshMeta.indexStart,
				meshMeta.indexStart + meshMeta.indexCount
			);
			const rebasedIndices = new Uint32Array(indicesSlice.length);
			const baseIndex = meshMeta.vertexStart;
			const windowEnd = meshMeta.vertexStart + meshMeta.vertexCount;
			for (let i = 0; i < indicesSlice.length; i++) {
				const indexValue = indicesSlice[i]!;
				if (indexValue < baseIndex || indexValue >= windowEnd) {
					throw indexOutOfWindow(indexValue, meshMeta);
				}
				rebasedIndices[i] = indexValue - baseIndex;
			}

			geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
			geometry.setIndex(new THREE.BufferAttribute(rebasedIndices, 1));
			if (allUvs) {
				const uvStart = meshMeta.vertexStart * 2;
				const uvs = allUvs.slice(uvStart, uvStart + meshMeta.vertexCount * 2);
				geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
			}
			if (allColors) {
				const colors = allColors.slice(componentStart, componentStart + componentLen);
				geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
			}
			geometry.computeVertexNormals();
			geometryCachePut(cacheKey, geometry);
		}

		meshes.push(finalizeSingleMesh(geometry, meshMeta, group, materials));
	}

	return meshes;
}

/** Wraps a single mesh's geometry (built or cache-hit) in its THREE.Mesh with identity/userData. */
function finalizeSingleMesh(
	geometry: THREE.BufferGeometry,
	meshMeta: MeshMetadata,
	group: MaterialGroup,
	materials: THREE.Material[]
): THREE.Mesh {
	const mesh = new THREE.Mesh(geometry, materials[group.materialId]);
	mesh.name = meshMeta.name;
	mesh.userData = {
		source: 'compute',
		name: meshMeta.name,
		layer: meshMeta.layer ?? '',
		originalIndex: meshMeta.originalIndex,
		metadata: meshMeta.metadata ?? {}
	};
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

// ============================================================================
// DEBUG HELPERS
// ============================================================================

function approximateBase64DecodedBytes(base64: string): number {
	return Math.floor((base64.length * 3) / 4);
}
