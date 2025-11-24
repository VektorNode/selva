import * as THREE from 'three';

import { applyOffset, computeCombinedBoundingBox } from '../threejs';
import { parseColor, ThreeDisplay, VerticesToThreeMesh } from '../threejs/three-helpers';

import { decompressMeshData } from './mesh-compression';

import type { DataItem, GrasshopperComputeResponse } from '@/features/grasshopper/types';

// Constants
const SCALE_FACTORS: Record<string, number> = {
  Millimeters: 1 / 1000,
  Centimeters: 1 / 100,
  Meters: 1,
  Inches: 1 / 39.37,
  Feet: 1 / 3.28084,
};

// Pre-compute rotation constants
const ROTATION_COS = Math.cos(-Math.PI / 2); // 0
const ROTATION_SIN = Math.sin(-Math.PI / 2); // -1
/**
 * The component type string used to identify display meshes from Grasshopper WebDisplay.
 */
const DISPLAY_COMPONENT_TYPE = 'ComputeBuilder.Display.ThreeDisplay';

/**
 * Extracts and processes display meshes from a ComputePointerResponse using the Grasshopper WebDisplay component.
 *
 * This function is an alternative to the standard "context bake" output of Hops/Grasshopper.
 * It is specifically designed to work with the WebDisplay component from the Compuceraptor Grasshopper plugin,
 * enabling performant mesh visualization in Three.js applications.
 *
 * Rhino Compute must be modified as already implemented in https://github.com/TheVessen/compute.rhino3d".
 *
 * THREE.Mesh instances using processBranch, and combines all meshes. It then computes a vertical offset
 * from the combined bounding box so the collection sits on the Z=0 plane.
 *
 * @param data - The ComputePointerResponse containing Grasshopper output trees.
 * @param debug - If true, logs processing time to the console.
 * @returns Array of THREE.Mesh objects (may be empty).
 * @throws Rethrows unexpected errors after attempting to dispose any created meshes.
 *
 * @remarks
 * - Only works with the WebDisplay component of GHHeadless.
 * - Requires changes to Rhino.Compute (see the fork above).
 * - Provides a performant way to display mesh data in Three.js.
 */
export function getThreeMeshesFromComputeResponse(
  data: GrasshopperComputeResponse,
  debug = false,
  options?: {
    allowScaling?: boolean;
    allowAutoPosition?: boolean;
  }
): THREE.Mesh[] {
  const startTime = performance.now();
  const meshes: THREE.Mesh[] = [];

  // Provide default values for options
  const { allowScaling = true, allowAutoPosition = true } = options ?? {};

  try {
    const scaleFactor = allowScaling ? getScaleFactor(data.modelunits) : 1;
    extractMeshesFromData(data, meshes, scaleFactor);
    if (allowAutoPosition) {
      applyGroundOffset(meshes);
    }

    return meshes;
  } catch (error) {
    handleError(error, meshes);
    throw error;
  } finally {
    if (debug) {
      logProcessingTime(startTime);
    }
  }
}

/**
 * Gets the scale factor for the given unit type.
 */
function getScaleFactor(modelUnits: string): number {
  return SCALE_FACTORS[modelUnits] ?? 1;
}

/**
 * Extracts meshes from compute response data.
 */
function extractMeshesFromData(
  data: GrasshopperComputeResponse,
  meshes: THREE.Mesh[],
  scaleFactor: number
): void {
  for (const value of data.values) {
    const innerTree = value.InnerTree as { [key: string]: DataItem[] };

    for (const path in innerTree) {
      const branch = innerTree[path];
      if (!branch) continue;

      processDataBranch(branch, meshes, scaleFactor);
    }
  }
}

/**
 * Processes a single data branch to extract display meshes.
 */
function processDataBranch(branch: DataItem[], meshes: THREE.Mesh[], scaleFactor: number): void {
  for (const item of branch) {
    if (item.type === DISPLAY_COMPONENT_TYPE) {
      const rhinoMeshData = parseRhinoMeshData(item.data);
      const branchMeshes = processBranch(rhinoMeshData, scaleFactor);
      meshes.push(...branchMeshes);
    }
  }
}

/**
 * Applies vertical offset to position meshes on the Z=0 plane.
 */
function applyGroundOffset(meshes: THREE.Mesh[]): void {
  if (meshes.length === 0) return;

  const combinedBoundingBox = computeCombinedBoundingBox(meshes);
  const offsetY = combinedBoundingBox.min.y;
  applyOffset(meshes, offsetY);
}

/**
 * Parses Rhino mesh data from string or object format.
 */
function parseRhinoMeshData(data: string | unknown): ThreeDisplay {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as ThreeDisplay;
    } catch {
      return data as unknown as ThreeDisplay;
    }
  }
  return data as ThreeDisplay;
}

/**
 * Handles errors by disposing created meshes and logging.
 */
function handleError(error: unknown, meshes: THREE.Mesh[]): void {
  console.error('An unexpected error occurred:', error);
  disposeMeshes(meshes);
}

/**
 * Disposes of all meshes and their associated resources.
 */
function disposeMeshes(meshes: THREE.Mesh[]): void {
  for (const mesh of meshes) {
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  }
}

/**
 * Logs the processing time for mesh extraction.
 */
function logProcessingTime(startTime: number): void {
  const elapsed = performance.now() - startTime;
  console.info('Time to process meshes:', `${elapsed.toFixed(2)}ms`);
}

/**
 * Processes a branch of tree data and generates an array of THREE.Mesh objects.
 *
 * @param treeData - The tree data containing mesh information and display properties. (This data is generated from the WebDisplay component in Grasshopper).
 * @param scaleFactor - The factor by which to scale the mesh vertices.
 * @returns An array of THREE.Mesh objects created from the provided tree data.
 *
 * @remarks
 * - Decompresses the mesh data, scales and rotates the vertices, and applies material properties.
 * - If decompression fails, logs an error and returns an empty array.
 */
function processBranch(treeData: ThreeDisplay, scaleFactor: number): THREE.Mesh[] {
  try {
    const decompressedData = decompressMeshData(treeData.meshData);

    if (!decompressedData) {
      console.error(`Failed to decompress mesh data for: ${treeData.name}`);
      return [];
    }

    const { verticesArray, faceIndicesArray } = decompressedData;

    if (!verticesArray || verticesArray.length === 0) {
      console.error(`Empty vertices array for: ${treeData.name}`);
      return [];
    }

    scaleAndRotateVertices(verticesArray, scaleFactor);
    const mesh = VerticesToThreeMesh(verticesArray, faceIndicesArray);
    mesh.name = treeData.name;
    applyMaterial(mesh, treeData);

    return [mesh];
  } catch (error) {
    console.error(`Error processing mesh ${treeData.name}:`, error);
    return [];
  }
}

/**
 * Applies a material to a THREE.Mesh object.
 *
 * @param mesh - The mesh to apply the material to.
 * @param rhinoMeshData - Object from grasshopper containing the material information.
 */
function applyMaterial(mesh: THREE.Mesh, rhinoMeshData: ThreeDisplay) {
  const color =
    typeof rhinoMeshData.color === 'string'
      ? parseColor(rhinoMeshData.color)
      : new THREE.Color(0xffffff);

  mesh.material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: rhinoMeshData.metalness,
    roughness: rhinoMeshData.roughness,
    side: THREE.DoubleSide,
    opacity: rhinoMeshData.opacity,
    transparent: rhinoMeshData.opacity < 1,
  });

  mesh.receiveShadow = true;
  mesh.castShadow = true;
}

/**
 * Scales and rotates the vertices of a mesh based on the given scale factor.
 *
 * @param vertices - The vertices of the mesh as a Float32Array.
 * @param scaleFactor - The scale factor to apply to the vertices.
 */
function scaleAndRotateVertices(vertices: Float32Array | undefined, scaleFactor: number): void {
  if (!vertices?.length) {
    console.error('Vertices array is undefined or empty.');
    return;
  }

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];

    vertices[i] = x * scaleFactor;
    vertices[i + 1] = (y * ROTATION_COS - z * ROTATION_SIN) * scaleFactor;
    vertices[i + 2] = (y * ROTATION_SIN + z * ROTATION_COS) * scaleFactor;
  }
}
