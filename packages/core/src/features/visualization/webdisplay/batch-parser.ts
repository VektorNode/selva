import * as THREE from 'three';

import { parseColor } from '../threejs/three-helpers';

import { decompressBatchedMeshData } from './mesh-compression';

import type { MeshBatch, MaterialGroup, MeshMetadata, SerializableMaterial } from './types';

/**
 * Parses a batched mesh JSON and creates Three.js meshes.
 *
 * This function handles the optimized batch format where:
 * - Materials are deduplicated and stored once
 * - Meshes are grouped by material for efficient rendering
 * - All geometry data is compressed together and decompressed in a Web Worker
 *
 * @param batchJson - JSON string containing the batched mesh data
 * @param options - Rendering options
 * @returns Promise resolving to array of Three.js mesh objects
 */
export async function parseMeshBatch(
  batchJson: string,
  options?: {
    /** Merge meshes with same material into single geometry (better performance) */
    mergeByMaterial?: boolean;
    /** Apply coordinate system transformations */
    applyTransforms?: boolean;
    /** Enable performance monitoring */
    debug?: boolean;
  }
): Promise<THREE.Mesh[]> {
  const { mergeByMaterial = true, applyTransforms = true, debug = false } = options ?? {};

  const perfStart = debug ? performance.now() : 0;
  let parseTime = 0, decompressTime = 0, meshCreateTime = 0;

  try {
    const parseStart = performance.now();
    const batch: MeshBatch = JSON.parse(batchJson);
    parseTime = performance.now() - parseStart;

    // Decompress all geometry data at once (in a Web Worker)
    const decompressStart = performance.now();
    const { vertices, faces } = await decompressBatchedMeshData(batch.compressedData);
    decompressTime = performance.now() - decompressStart;

    const compressedSizeMB = (batch.compressedData.length * 0.75 / 1024 / 1024).toFixed(2); // Base64 overhead
    const uncompressedSizeMB = ((vertices.byteLength + faces.byteLength) / 1024 / 1024).toFixed(2);
    const compressionRatio = ((1 - (parseFloat(compressedSizeMB) / parseFloat(uncompressedSizeMB))) * 100).toFixed(1);

    if (debug) {
      console.log('📊 Mesh Batch Stats:');
      console.log(`  Materials: ${batch.materials.length} | Groups: ${batch.groups.length}`);
      console.log(`  Vertices: ${(vertices.length / 3).toLocaleString()} | Faces: ${(faces.length / 3).toLocaleString()}`);
      console.log(`  Compressed: ${compressedSizeMB} MB | Uncompressed: ${uncompressedSizeMB} MB`);
      console.log(`  Compression Ratio: ${compressionRatio}%`);
    }

    // Apply transforms if needed
    if (applyTransforms) {
      applyCoordinateTransform(vertices);
    }

    // Create material instances (reusable)
    const meshCreateStart = performance.now();
    const materials = batch.materials.map(createMaterial);

    const meshes: THREE.Mesh[] = [];

    // Process each material group
    for (const group of batch.groups) {
      if (mergeByMaterial && group.meshes.length > 1) {
        const mergedMesh = createMergedMesh(group, vertices, faces, materials);
        meshes.push(mergedMesh);
      } else {
        const individualMeshes = createIndividualMeshes(group, vertices, faces, materials);
        meshes.push(...individualMeshes);
      }
    }
    meshCreateTime = performance.now() - meshCreateStart;

    if (debug) {
      const totalTime = performance.now() - perfStart;
      console.log('⏱️ Performance:');
      console.log(`  Parse JSON: ${parseTime.toFixed(2)}ms`);
      console.log(`  Decompress: ${decompressTime.toFixed(2)}ms`);
      console.log(`  Create Meshes: ${meshCreateTime.toFixed(2)}ms`);
      console.log(`  Total: ${totalTime.toFixed(2)}ms`);
    }

    return meshes;
  } catch (error) {
    console.error('Error parsing mesh batch:', error);
    return [];
  }
}

/**
 * Creates a Three.js material from serializable material data.
 */
function createMaterial(matData: SerializableMaterial): THREE.MeshPhysicalMaterial {
  const color = parseColor(matData.color);

  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: matData.metalness,
    roughness: matData.roughness,
    opacity: matData.opacity,
    transparent: matData.transparent,
    side: THREE.DoubleSide,
  });
}

/**
 * Creates a merged mesh from multiple meshes sharing the same material.
 * This is optimal for rendering many small meshes.
 * Optimized to minimize memory allocations and copies.
 */
function createMergedMesh(
  group: MaterialGroup,
  allVertices: Float32Array,
  allFaces: Uint32Array,
  materials: THREE.Material[]
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();

  // Calculate total size
  let totalVertexFloats = 0;
  let totalFaceIndices = 0;

  for (const mesh of group.meshes) {
    totalVertexFloats += mesh.vertexCount;
    totalFaceIndices += mesh.faceCount;
  }

  // Allocate merged arrays
  const mergedVertices = new Float32Array(totalVertexFloats);
  const mergedIndices = new Uint32Array(totalFaceIndices);

  let vertexWriteOffset = 0;
  let indexWriteOffset = 0;
  let baseVertexIndex = 0;

  // Merge all meshes - optimized loop
  for (const mesh of group.meshes) {
    // Copy vertices using set() - zero-copy when possible
    mergedVertices.set(
      allVertices.subarray(mesh.vertexOffset, mesh.vertexOffset + mesh.vertexCount),
      vertexWriteOffset
    );

    // Copy and adjust face indices
    const faceSlice = allFaces.subarray(mesh.faceOffset, mesh.faceOffset + mesh.faceCount);

    // Optimized index adjustment
    for (let i = 0; i < faceSlice.length; i++) {
      mergedIndices[indexWriteOffset + i] = faceSlice[i] + baseVertexIndex;
    }

    vertexWriteOffset += mesh.vertexCount;
    indexWriteOffset += mesh.faceCount;
    baseVertexIndex += mesh.vertexCount / 3;
  }

  // Set geometry attributes directly (no additional copies)
  geometry.setAttribute('position', new THREE.BufferAttribute(mergedVertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
  geometry.computeVertexNormals();

  const threeMesh = new THREE.Mesh(geometry, materials[group.materialId]);
  threeMesh.name = `merged_material_${group.materialId}`;
  threeMesh.castShadow = true;
  threeMesh.receiveShadow = true;

  return threeMesh;
}

/**
 * Creates individual meshes from a material group.
 * This allows independent control of each mesh.
 */
function createIndividualMeshes(
  group: MaterialGroup,
  allVertices: Float32Array,
  allFaces: Uint32Array,
  materials: THREE.Material[]
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];

  for (const meshMeta of group.meshes) {
    const geometry = new THREE.BufferGeometry();

    // Extract vertex data
    const vertices = allVertices.subarray(
      meshMeta.vertexOffset,
      meshMeta.vertexOffset + meshMeta.vertexCount
    );

    // Extract and rebase face indices
    const faces = allFaces.subarray(
      meshMeta.faceOffset,
      meshMeta.faceOffset + meshMeta.faceCount
    );

    // Rebase indices to start from 0
    const baseIndex = meshMeta.vertexOffset / 3;
    const rebasedFaces = new Uint32Array(faces.length);
    for (let i = 0; i < faces.length; i++) {
      rebasedFaces[i] = faces[i] - baseIndex;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(rebasedFaces, 1));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, materials[group.materialId]);
    mesh.name = meshMeta.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    meshes.push(mesh);
  }

  return meshes;
}

/**
 * Applies Rhino to Three.js coordinate system transformation.
 * Rhino uses Z-up, Three.js uses Y-up.
 */
function applyCoordinateTransform(vertices: Float32Array): void {
  const cos = Math.cos(-Math.PI / 2);
  const sin = Math.sin(-Math.PI / 2);

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];

    vertices[i] = x;
    vertices[i + 1] = y * cos - z * sin;
    vertices[i + 2] = y * sin + z * cos;
  }
}
