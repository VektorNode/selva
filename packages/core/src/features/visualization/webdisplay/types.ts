/**
 * Material properties for Three.js rendering.
 */
export interface SerializableMaterial {
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  transparent: boolean;
}

/**
 * Metadata for a single mesh within a batch.
 */
export interface MeshMetadata {
  name: string;
  vertexCount: number;
  faceCount: number;
  /** Offset in the combined vertex array (in number of floats) */
  vertexOffset: number;
  /** Offset in the combined face index array (in number of integers) */
  faceOffset: number;
}

/**
 * A group of meshes sharing the same material.
 */
export interface MaterialGroup {
  /** Reference to the material ID in the materials array */
  materialId: number;
  /** Individual meshes in this group */
  meshes: MeshMetadata[];
}

/**
 * Batched mesh data optimized for Three.js rendering.
 */
export interface MeshBatch {
  /** Array of unique materials */
  materials: SerializableMaterial[];
  /** Groups of meshes organized by material */
  groups: MaterialGroup[];
  /** Compressed binary data containing all vertices and faces */
  compressedData: string;
}

/**
 * Decompressed mesh data.
 */
export interface DecompressedMeshData {
  vertices: Float32Array;
  faces: Uint32Array;
}
