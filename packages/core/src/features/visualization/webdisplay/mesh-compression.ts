import * as fflate from 'fflate';

import { decodeBase64ToBinary } from '@/core/index';

interface MeshData {
  verticesArray: Float32Array;
  faceIndicesArray: Uint32Array;
}

/**
 * Decompresses a base64-encoded string and returns the decompressed MeshData.
 * @param base64String - The base64-encoded string to decompress.
 * @returns The decompressed MeshData.
 * @throws If decompression fails or data is invalid.
 */
export function decompressMeshData(base64String: string): MeshData {
  try {
    const bytes = decodeBase64ToBinary(base64String);
    const decompressedData = fflate.gunzipSync(bytes);
    return parseMeshBinaryData(decompressedData);
  } catch (error) {
    console.error('Decompression failed:', error);
    throw new Error('Failed to decompress data');
  }
}

/**
 * Parses binary data and returns mesh data.
 * @param binaryMeshData - The binary mesh data to parse.
 * @returns The parsed mesh data.
 * @throws If data is invalid or insufficient.
 */
function parseMeshBinaryData(binaryMeshData: Uint8Array): MeshData {
  const dataView = new DataView(
    binaryMeshData.buffer,
    binaryMeshData.byteOffset,
    binaryMeshData.byteLength
  );
  let offset = 0;

  // Read the total number of floats in vertices array
  if (offset + 4 > dataView.byteLength) {
    throw new Error('Insufficient data to read the number of vertex floats.');
  }
  const numVertexFloats = dataView.getUint32(offset, true);
  offset += 4;

  if (numVertexFloats % 3 !== 0) {
    throw new Error('Invalid number of vertex floats; should be divisible by 3.');
  }

  const verticesByteLength = numVertexFloats * Float32Array.BYTES_PER_ELEMENT;
  if (offset + verticesByteLength > dataView.byteLength) {
    throw new Error('Insufficient data to read vertices.');
  }

  // Create Float32Array directly
  const vertices = new Float32Array(
    binaryMeshData.buffer,
    binaryMeshData.byteOffset + offset,
    numVertexFloats
  );
  offset += verticesByteLength;

  // Read the total number of face indices
  if (offset + 4 > dataView.byteLength) {
    throw new Error('Insufficient data to read the number of face indices.');
  }
  const numIndices = dataView.getUint32(offset, true);
  offset += 4;

  const indicesByteLength = numIndices * Uint32Array.BYTES_PER_ELEMENT;
  if (offset + indicesByteLength > dataView.byteLength) {
    throw new Error('Insufficient data to read face indices.');
  }

  // Create Uint32Array directly
  const faceIndices = new Uint32Array(
    binaryMeshData.buffer,
    binaryMeshData.byteOffset + offset,
    numIndices
  );

  return {
    verticesArray: vertices,
    faceIndicesArray: faceIndices,
  };
}
