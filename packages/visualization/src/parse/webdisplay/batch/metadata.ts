import { VisualizationError, ErrorCodes } from '../../../shared/index.js';

import { fingerprintViews } from '../geometry-cache.js';

import type { MaterialGroup, MeshMetadata } from '../types.js';

export function metadataFail(
	message: string,
	context: Record<string, unknown>
): VisualizationError {
	return new VisualizationError(message, ErrorCodes.VALIDATION_ERROR, { context });
}

/**
 * Validates the batch's group/mesh metadata against the decoded geometry buffers before any of it
 * is used arithmetically. Throws a VALIDATION_ERROR on the first inconsistency (out-of-range
 * `materialId`, non-integer or negative offsets/counts, or vertex/index windows that overrun the
 * buffers) so malformed or version-skewed metadata fails the parse loudly.
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
 * unsigned array, so a violation would otherwise wrap to ~4 billion and corrupt the geometry.
 * The range checks themselves are inlined in the copy loops (audit P6 — a function call per index
 * was measurable at millions of indices); this only builds the failure.
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
 * Content key for the cross-solve geometry cache: samples of every buffer window this geometry is
 * built from, plus the window layout as salt (identical bytes at a different offset rebase to
 * different geometry). See ../geometry-cache.ts for the safety model.
 */
export function geometryContentKey(
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
 * frame end to end (the Three scene is Rhino's Z-up frame — see `../../shared/coordinate-frame.ts`), so
 * vertices pass through unrotated. `_applyCoordinateTransform` is retained for call-site
 * compatibility and no longer changes the output.
 */
export function dequantizeInt16(
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
export function maybeRotateFloat32Vertices(
	vertices: Float32Array,
	_applyCoordinateTransform: boolean
): Float32Array {
	return vertices;
}
