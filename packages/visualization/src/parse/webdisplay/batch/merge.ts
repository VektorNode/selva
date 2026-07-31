import * as THREE from 'three';

import { geometryCacheGet, geometryCachePut } from '../geometry-cache.js';
import { geometryContentKey, indexOutOfWindow } from './metadata.js';

import type { MaterialGroup, MeshMetadata } from '../types.js';

/**
 * Merges a material group's meshes into one BufferGeometry. Parser indices already address the
 * combined vertex array (rebased by the C# pipeline during batch assembly), so this copies each
 * mesh's vertex/index slices into a fresh contiguous buffer and shifts indices to match.
 */
export function createMergedMesh(
	group: MaterialGroup,
	allVertices: Float32Array,
	allIndices: Uint16Array | Uint32Array,
	materials: THREE.Material[],
	allUvs: Float32Array | null = null,
	allColors: Uint8Array | null = null
): THREE.Mesh {
	// Cross-solve reuse: identical content → same BufferGeometry object, skipping the merge copies,
	// computeVertexNormals, and the GPU re-upload entirely.
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

export function finalizeMergedMesh(
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
export function createIndividualMeshes(
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

		// Cross-solve reuse — see createMergedMesh.
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

export function finalizeSingleMesh(
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
