import { VisualizationError, ErrorCodes } from '../../../shared/index.js';

import type { MaterialGroup, MeshMetadata } from '../types.js';

export function metadataFail(
	message: string,
	context: Record<string, unknown>
): VisualizationError {
	return new VisualizationError(message, ErrorCodes.VALIDATION_ERROR, { context });
}

/**
 * Validates the batch's group/mesh metadata against the decoded geometry buffers before any of it
 * is used arithmetically. Throws on the first inconsistency (out-of-range `materialId`,
 * non-integer or negative offsets/counts, or a vertex/index window that overruns the buffers), so
 * malformed or version-skewed metadata fails the parse loudly instead of corrupting the render.
 */
export function validateGroupMetadata(
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
 * unsigned array, so an out-of-window index would otherwise wrap to ~4 billion and corrupt the
 * geometry. Range checks live inline in the copy loops (a function call per index measured
 * noticeably slower at millions of indices): this only builds the failure.
 */
export function indexOutOfWindow(indexValue: number, meshMeta: MeshMetadata): VisualizationError {
	return metadataFail("Index references a vertex outside its mesh's vertex window.", {
		meshName: meshMeta.name,
		indexValue,
		vertexStart: meshMeta.vertexStart,
		vertexCount: meshMeta.vertexCount
	});
}

/**
 * Reconstructs world-unit float32 positions from int16 quantized values:
 * `world = origin + (q + 32767) * scale`. No rotation: the Three scene uses Rhino's Z-up frame,
 * so vertices pass through as they arrived.
 */
export function dequantizeInt16(
	q: Int16Array,
	origin: [number, number, number],
	scale: [number, number, number]
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
