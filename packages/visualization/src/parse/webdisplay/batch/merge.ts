import * as THREE from 'three';

import { indexOutOfWindow } from './metadata.js';

import type { MaterialGroup, MeshMetadata } from '../types.js';

/**
 * Split a material group into one sub-group per layer, preserving mesh order.
 *
 * Merging is by material alone, but a merged mesh is one THREE object and so can sit on exactly
 * one layer in the outliner. Without this split, two layers sharing a material collapse into a
 * single object filed under the first one, and hiding either layer hides both.
 */
export function splitGroupByLayer(group: MaterialGroup): MaterialGroup[] {
	const byLayer = new Map<string, MeshMetadata[]>();
	for (const meshMeta of group.meshes) {
		const layer = meshMeta.layer ?? '';
		let bucket = byLayer.get(layer);
		if (!bucket) {
			bucket = [];
			byLayer.set(layer, bucket);
		}
		bucket.push(meshMeta);
	}
	return [...byLayer.values()].map((meshes) => ({ materialId: group.materialId, meshes }));
}

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

	return finalizeMergedMesh(geometry, group, materials);
}

/**
 * One source object inside a merged mesh, as stamped into `userData.members`.
 *
 * Deliberately declared here rather than imported from `scene/`: the two layers are siblings, so
 * `parse` writing this shape and `scene` reading it back off `userData` is the only contract
 * between them. `scene/identity.ts` has the mirror of this interface.
 */
interface MergedMember {
	trackingKey?: string;
	name: string;
	layer: string;
	metadata: Record<string, string>;
	indexStart: number;
	indexCount: number;
}

/**
 * Per-member records for a merged mesh, each carrying its window into the merged index buffer.
 * The windows are a prefix sum over `indexCount` because the merge concatenates members in this
 * order — see the copy loop in {@link createMergedMesh}.
 */
function mergedMembers(group: MaterialGroup): MergedMember[] {
	const members: MergedMember[] = [];
	let indexStart = 0;
	for (const mesh of group.meshes) {
		members.push({
			trackingKey: mesh.id,
			name: mesh.name,
			layer: mesh.layer,
			metadata: mesh.metadata ?? {},
			indexStart,
			indexCount: mesh.indexCount
		});
		indexStart += mesh.indexCount;
	}
	return members;
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
		metadata: firstMesh?.metadata ?? {},
		// A merged mesh is several source objects in one THREE object, so identity lives per
		// member: the scene layer keys hidden state on every member's key, and regrouping can
		// never lose it.
		//
		// `indexStart`/`indexCount` are the member's window into the merged index buffer, which is
		// what maps a raycast hit back to the one source object under the cursor — without them a
		// click could only ever identify the whole merged mesh. The merge writes members in this
		// exact order (see the concatenation loop above), so the windows are a prefix sum over
		// `indexCount` and are never stored on the wire.
		members: mergedMembers(group)
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
		// The writer-minted identity; absent for foreign writers, and the scene layer then
		// falls back to name + layer.
		trackingKey: meshMeta.id,
		metadata: meshMeta.metadata ?? {}
	};
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}
