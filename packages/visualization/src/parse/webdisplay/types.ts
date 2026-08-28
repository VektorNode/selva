import type { DisplayItem } from '../display-items/types.js';
import type { MaterialAppearanceOptions } from '../../shared/types.js';

export interface SerializableMaterial {
	color: string;
	metalness: number;
	roughness: number;
	opacity: number;
	transparent: boolean;
	/**
	 * Optional color-map texture reference: http(s) URL, data URI, or plugin asset URL
	 * (`http://localhost:{port}/assets/{hash}`). Omitted entirely (not just empty) when untextured.
	 * When set, the mesh blob also carries per-vertex UVs (FLAG_HAS_UVS) for meshes using it.
	 */
	map?: string;
}

/**
 * `vertexStart`/`vertexCount` and `indexStart`/`indexCount` are in **element units** of the
 * decoded typed arrays, not bytes — vertex component offset is `vertexStart * 3` (component count
 * `vertexCount * 3`); index element offset is `indexStart` (count `indexCount`). For byte offsets,
 * multiply by element size: indices are 2 bytes (`FLAG_UINT16_INDICES`) or 4 bytes (uint32);
 * vertex components are 2 bytes (int16 quantized) or 4 bytes (`FLAG_FLOAT32`).
 */
export interface MeshMetadata {
	name: string;
	/** Layer path for grouping in the scene manager, e.g. 'Structure/Walls'. */
	layer: string;
	/** Index in the GH input tree before material grouping; combined with sourceComponentId
	 *  uniquely identifies the GH source geometry. */
	originalIndex: number;
	vertexCount: number;
	/** 3 per triangle. */
	indexCount: number;
	vertexStart: number;
	indexStart: number;
	/** Arbitrary key-value pairs from the GH Metadata input. */
	metadata?: Record<string, string>;
}

export interface MaterialGroup {
	materialId: number;
	meshes: MeshMetadata[];
}

/**
 * One Display component's payload, ready for Three.js rendering.
 *
 * `compressedData` is the binary "SLVA" blob, base64-encoded for transit inside the values JSON
 * envelope; opaque to the outer JSON so a future binary WebSocket frame can drop the base64 step
 * without changing this shape.
 *
 * Named `DisplayBatch` rather than `MeshBatch` because it's the seam non-mesh display items
 * (curves, points, later labels/icons) also travel through — those ride as JSON alongside the mesh
 * blob (`items`), not inside it.
 */
export interface DisplayBatch {
	materials: SerializableMaterial[];
	groups: MaterialGroup[];
	compressedData: string;
	/** The batch's identity namespace, combined with `MeshMetadata.originalIndex` to key a mesh
	 *  across solves. Usually the producing GH component's InstanceGuid, but not always — a
	 *  combined batch takes the combiner's id, and records each mesh's true origin in its
	 *  `metadata['gh:component']`. The JSON name is the wire contract and cannot change. */
	sourceComponentId?: string;
	/** Non-mesh display items — see {@link DisplayItem}. Parsed by the separate `display-items`
	 *  path, not the SLVA mesh parser. Omitted when there are none. */
	items?: DisplayItem[];
}

export interface MeshBatchParsingOptions {
	/** Merge meshes sharing a material into a single geometry. Defaults to true. */
	mergeByMaterial?: boolean;
	debug?: boolean;
	/**
	 * Appearance dials applied to every material built from this batch — set once at parse time
	 * (materials are rebuilt per solve). Runtime restyling of an already-built scene lives in the
	 * viewer's `setLook`.
	 */
	material?: MaterialAppearanceOptions;
}

/** Single definition lives in `shared/types.ts`; re-exported here so the render layer can read a
 *  look's material dials without importing upward into `parse/`. */
export type { MaterialAppearanceOptions } from '../../shared/types.js';

export interface MeshExtractionOptions {
	parsing?: MeshBatchParsingOptions;
	/** Scale geometry to model units. Defaults to true. */
	allowScaling?: boolean;
	/**
	 * Drop geometry so its lowest point sits on the ground plane. **Defaults to `false`** — content
	 * renders at its true Rhino coordinates, matching the Grasshopper definition. Setting `true`
	 * shifts objects, so anything read back out of the scene (bounds, measured/picked positions) no
	 * longer corresponds to Rhino coordinates.
	 */
	allowAutoPosition?: boolean;
	/** Up axis for `allowAutoPosition` grounding. Defaults to `'z'` (Rhino's frame) — only set this
	 *  if the viewer is configured with a non-default `sceneUp`. */
	groundAxis?: 'x' | 'y' | 'z';
	debug?: boolean;
}
