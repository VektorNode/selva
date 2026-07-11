import * as THREE from 'three';

import { parseColor } from '../threejs/three-helpers';
import { getLogger } from '@/core';

import { FLAG_FLOAT32, parseBinaryMeshBatch } from './binary-parser';
import { applyTextureMap } from './texture-cache';

import type { ParsedBinaryMeshBatch } from './binary-parser';
import type {
	DisplayBatch,
	MaterialAppearanceOptions,
	MaterialGroup,
	MeshBatchParsingOptions,
	SerializableMaterial
} from './types';

/**
 * Internal-only telemetry threaded from an outer entry point (e.g. the JSON
 * `parseMeshBatch` measuring its own `JSON.parse` cost) into the shared build
 * step. Never part of any public options surface — callers don't supply timings.
 */
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
 * @param batchJson - JSON string containing the batched mesh data
 * @param options - Rendering options
 * @returns Promise resolving to array of Three.js mesh objects
 */
export async function parseMeshBatch(
	batchJson: string,
	options?: MeshBatchParsingOptions
): Promise<THREE.Mesh[]> {
	const { debug = false } = options ?? {};

	const perfStart = debug ? performance.now() : 0;

	try {
		const parseStart = performance.now();
		const batch: DisplayBatch = JSON.parse(batchJson);
		const parseTime = performance.now() - parseStart;

		return await parseMeshBatchObject(batch, options, { parseTime, perfStart });
	} catch (error) {
		getLogger().error('Error parsing mesh batch:', error);
		return [];
	}
}

/**
 * Parses a DisplayBatch object and creates Three.js meshes from its mesh blob.
 *
 * The path is synchronous internally — `parseBinaryMeshBatch` does no IO, just typed-array views
 * over the blob. The function stays `async` so callers don't have to change shape if we move
 * parsing into a worker later.
 *
 * @param batch - DisplayBatch object
 * @param options - Rendering options
 * @returns Promise resolving to array of Three.js mesh objects
 */
export async function parseMeshBatchObject(
	batch: DisplayBatch,
	options?: MeshBatchParsingOptions,
	/** @internal Timings threaded from an outer entry point; not a caller option. */
	telemetry?: ParseTelemetry
): Promise<THREE.Mesh[]> {
	const { mergeByMaterial = true, applyTransforms = true, debug = false, material } = options ?? {};
	const { parseTime = 0, perfStart = debug ? performance.now() : 0 } = telemetry ?? {};

	try {
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
	} catch (error) {
		getLogger().error('Error parsing mesh batch object:', error);
		return [];
	}
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
 */
export async function parseMeshBatchBlob(
	blob: ArrayBuffer | Uint8Array,
	options?: MeshBatchParsingOptions
): Promise<THREE.Mesh[]> {
	const { mergeByMaterial = true, applyTransforms = true, debug = false, material } = options ?? {};

	const perfStart = debug ? performance.now() : 0;

	try {
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
	} catch (error) {
		getLogger().error('Error parsing mesh batch blob:', error);
		return [];
	}
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

	// Dequantize once up-front into a single Float32Array. Downstream code (per-group merging,
	// computeVertexNormals, ground-offset) all expect world-unit floats, and a single
	// linear pass over the int16 buffer is far cheaper than the legacy gunzip + base64 path. The
	// Z-up -> Y-up rotation, when requested, is folded into the same pass.
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
// DEQUANTIZATION
// ============================================================================

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
// MATERIAL CONSTRUCTION
// ============================================================================

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
		if (indexShift === 0) {
			mergedIndices.set(indicesSlice, indexWriteCursor);
		} else {
			for (let i = 0; i < indicesSlice.length; i++) {
				mergedIndices[indexWriteCursor + i] = indicesSlice[i]! + indexShift;
			}
		}

		vertexWriteCursor += meshMeta.vertexCount;
		indexWriteCursor += meshMeta.indexCount;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(mergedVertices, 3));
	geometry.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
	if (mergedUvs) {
		geometry.setAttribute('uv', new THREE.BufferAttribute(mergedUvs, 2));
	}
	if (mergedColors) {
		geometry.setAttribute('color', new THREE.BufferAttribute(mergedColors, 3, true));
	}
	geometry.computeVertexNormals();

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

		// `subarray` returns a view; copy via `slice` so the BufferAttribute owns its memory and
		// downstream code (dispose/reuse) can't surprise us by sharing the parser's buffer.
		const vertices = allVertices.slice(componentStart, componentStart + componentLen);

		const indicesSlice = allIndices.subarray(
			meshMeta.indexStart,
			meshMeta.indexStart + meshMeta.indexCount
		);
		const rebasedIndices = new Uint32Array(indicesSlice.length);
		const baseIndex = meshMeta.vertexStart;
		for (let i = 0; i < indicesSlice.length; i++) {
			rebasedIndices[i] = indicesSlice[i]! - baseIndex;
		}

		const geometry = new THREE.BufferGeometry();
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
