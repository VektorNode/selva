import type { DisplayItem } from '../display-items/types.js';
import type { RhinoModule } from 'rhino3dm';
import type { MaterialAppearanceOptions } from '../../shared/types.js';

/** Material properties for Three.js rendering. */
export interface SerializableMaterial {
	color: string;
	metalness: number;
	roughness: number;
	opacity: number;
	transparent: boolean;
	/**
	 * Optional color-map texture reference: an http(s) URL, a data URI, or a plugin asset URL
	 * (`http://localhost:{port}/assets/{hash}`). Absent for untextured materials — the field is
	 * omitted from JSON entirely, so pre-texture payloads are unchanged. When set, the mesh blob
	 * also carries per-vertex UVs (FLAG_HAS_UVS) for meshes using this material.
	 */
	map?: string;
}

/**
 * Metadata for a single mesh within a batch.
 *
 * `vertexStart`/`vertexCount` and `indexStart`/`indexCount` are in **element units** of the
 * decoded typed arrays (`indices.subarray(indexStart, indexStart + indexCount)`), not bytes:
 *   - vertex component offset = `vertexStart * 3`, component count = `vertexCount * 3`
 *   - index element offset = `indexStart`, count = `indexCount`
 *
 * For byte offsets, multiply by element size: indices are 2 bytes (`FLAG_UINT16_INDICES`) or 4
 * bytes (uint32); vertex components are 2 bytes (int16 quantized) or 4 bytes (`FLAG_FLOAT32`).
 */
export interface MeshMetadata {
	name: string;
	/** Layer path for grouping in the scene manager (e.g. 'Structure/Walls') */
	layer: string;
	/** Original index in the GH input tree before material grouping. Combined with
	 *  MeshBatch.sourceComponentId to uniquely identify the GH source geometry. */
	originalIndex: number;
	/** Vertex count (each vertex is 3 components: x, y, z). */
	vertexCount: number;
	/** Index count (3 per triangle). */
	indexCount: number;
	/** First vertex of this mesh in the combined vertex array (vertex-count units); component
	 *  offset into the typed array is `vertexStart * 3`. */
	vertexStart: number;
	/** First index of this mesh in the combined index array (index-count units). */
	indexStart: number;
	/** Arbitrary key-value pairs from the GH Metadata input */
	metadata?: Record<string, string>;
}

/** A group of meshes sharing the same material. */
export interface MaterialGroup {
	/** Index into the batch's materials array. */
	materialId: number;
	meshes: MeshMetadata[];
}

/**
 * One Display component's payload, ready for Three.js rendering.
 *
 * `compressedData` contains the binary "SLVA" blob (header + metadata JSON + quantized int16 or
 * float32 vertices + uint32 indices), base64-encoded for transit inside the values JSON envelope.
 * The blob is opaque to the outer JSON: a future binary WebSocket frame can drop the base64 step
 * without changing this shape.
 *
 * Today this carries only meshes (the binary blob). It is named `DisplayBatch` rather than
 * `MeshBatch` because it is the seam through which non-mesh display items (curves, points, and
 * later labels/icons) also travel — those ride as JSON alongside the mesh blob, not inside it.
 */
export interface DisplayBatch {
	materials: SerializableMaterial[];
	groups: MaterialGroup[];
	compressedData: string;
	/** InstanceGuid of the WebDisplay GH component that produced this batch.
	 *  Combined with MeshMetadata.originalIndex to backtrack any mesh to its GH source. */
	sourceComponentId?: string;
	/**
	 * Non-mesh display items (curves, points; later labels/icons) — see {@link DisplayItem}.
	 * Optional: omitted when there are none, so mesh-only batches are unchanged on the wire. These
	 * ride as JSON alongside the mesh blob and are parsed by the separate `display-items` path, not
	 * the SLVA mesh parser.
	 */
	items?: DisplayItem[];
}

export interface MeshBatchParsingOptions {
	/** Merge meshes with same material into single geometry. Defaults to true. */
	mergeByMaterial?: boolean;
	/** Apply coordinate system transformations. Defaults to true. */
	applyTransforms?: boolean;
	/** Enable performance monitoring. Defaults to false. */
	debug?: boolean;
	/**
	 * Appearance dials applied to every material built from this batch. These drive how "studio"
	 * vs "matte technical" the meshes look; they are set once at parse time (materials are rebuilt
	 * per solve). Runtime restyling of an already-built scene lives in the viewer's `setLook`.
	 */
	material?: MaterialAppearanceOptions;
}

/**
 * Re-exported from `shared/` so the render layer can read a look's material dials
 * (`materialAppearanceForLook`) without importing upward into `parse/`. Single definition lives in
 * `shared/types.ts`.
 */
export type { MaterialAppearanceOptions } from '../../shared/types.js';

/** Options for extracting and processing meshes from compute responses. */
export interface MeshExtractionOptions {
	/** Configuration for parsing mesh batches. */
	parsing?: MeshBatchParsingOptions;
	/** Apply scaling based on model units. Defaults to true. */
	allowScaling?: boolean;
	/**
	 * Drop geometry so its lowest point sits on the ground plane. **Defaults to `false`** — content
	 * renders at its true Rhino coordinates, so the viewer matches the Grasshopper definition.
	 *
	 * Set `true` to always seat the model on the grid regardless of where it sits in Rhino. Note
	 * this shifts objects, so anything read back out of the scene (bounds, measured or picked
	 * positions) no longer corresponds to the model's Rhino coordinates.
	 */
	allowAutoPosition?: boolean;
	/**
	 * The scene's up axis, used by the `allowAutoPosition` grounding to decide which component to
	 * drop to zero. Defaults to `'z'` — the frame Rhino geometry arrives in. Only set this if the
	 * viewer is configured with a non-default `sceneUp`.
	 */
	groundAxis?: 'x' | 'y' | 'z';
	/**
	 * rhino3dm instance for decoding curve display items. selva-compute does not own the WASM
	 * instance; the host threads it in. Omit to skip curves (points still render).
	 */
	rhino?: RhinoModule;
	/** Enable verbose logging. Defaults to false. */
	debug?: boolean;
}
