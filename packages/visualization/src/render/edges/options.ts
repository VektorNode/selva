import * as THREE from 'three';

/**
 * Crisp boundary/crease edges overlaid on meshes — the defining "technical drawing" look that makes
 * shaded geometry read as discrete objects rather than blobs.
 *
 * See the layer README for the full performance and depth-strategy notes; this module holds only the
 * option surface, its defaults, and the tuning constants the other edge modules read.
 */
export interface EdgeOptions {
	/**
	 * Force a single edge color for every overlay. Omitted (default): each overlay derives its color
	 * from its own mesh's material (a darkened tint), falling back to {@link DEFAULT_EDGE_COLOR}
	 * when no material color is readable.
	 */
	color?: THREE.ColorRepresentation;
	/**
	 * How far to darken the derived edge color toward black, 0–1 (default 0.75). Only applies when
	 * `color` is omitted. Higher = darker edges; 0 leaves edges the surface color, 1 makes them black.
	 */
	darken?: number;
	/** Edge thickness in CSS px. Default 1.5. */
	width?: number;
	/**
	 * Crease angle in degrees: an edge is kept only where its two faces differ by more than this.
	 * Default 44. Higher = fewer edges (only sharp creases); lower = more (catches gentle bends).
	 */
	thresholdAngle?: number;
	/**
	 * Fade an overlay out as its own edges crowd together on screen (default true). Edges draw at
	 * constant pixel width, so dense edges (e.g. millimetre-pitch laminations on sheet goods) merge
	 * into a dark smear at normal zoom; fading by edge density rather than mesh size fixes that
	 * while leaving sparsely-edged geometry fully drawn.
	 */
	distanceFade?: boolean;
	/**
	 * Skip meshes above this triangle count entirely (default 4M) — extraction time is linear in
	 * triangles, and past this bound even the worker path burns seconds for a look the screen-space
	 * fallback approximates at constant cost. Skipped meshes are tagged
	 * `userData.edgesSkipped = 'triangle-cap'` so hosts can react (e.g. enable the render-pipeline
	 * edge pass).
	 */
	maxTriangles?: number;
	/**
	 * Above this many extracted segments (default 2M), an overlay drops the distance fade so it
	 * renders opaque — millions of blended fat-line quads are a fill-rate cliff; opaque ones aren't.
	 */
	maxSegments?: number;
}

/** Tag on edge overlays so pick/fit/clear logic can recognize and skip or dispose them. */
export const EDGE_USERDATA_KIND = 'edge-overlay';

/** `userData.edgesSkipped` value on meshes whose triangle count exceeded {@link EdgeOptions.maxTriangles}. */
export const EDGES_SKIPPED_TRIANGLE_CAP = 'triangle-cap';

export const DEFAULT_EDGE_COLOR = 0x222222;
const DEFAULT_EDGE_WIDTH = 1.5;
const DEFAULT_THRESHOLD_ANGLE = 44;
const DEFAULT_DARKEN = 0.75;
const DEFAULT_MAX_TRIANGLES = 4_000_000;
const DEFAULT_MAX_SEGMENTS = 2_000_000;

/** Below this triangle count extraction runs inline even on the async path — a worker round-trip costs more than the extraction itself. */
export const INLINE_TRIANGLE_BUDGET = 25_000;

/** CPU byte budget for the cross-solve segment cache (Float32 segment arrays only). */
export const SEGMENT_CACHE_BYTE_BUDGET = 128 * 1024 * 1024;

// Edge-density fade band, as mean on-screen gap between neighbouring edges in px: fully opaque
// at/above FADE_START_PX, fully gone at/below FADE_END_PX, linear between. Fading by density
// (not by mesh/bounding-sphere size) is required because a big part with sub-pixel edge spacing
// still draws every line at full width, merging into a smear the old bounding-sphere rule never
// caught (the sphere still covers most of the viewport). Band sits just above 1px, where
// constant-width lines start visibly overlapping.
export const FADE_START_PX = 4;
export const FADE_END_PX = 1;

// Edge pull-forward, units only — deliberately no slope (factor) term. A slope term scales with
// the polygon's dZ/dpixel, which is huge at grazing angles; applied to surfaces (the old strategy)
// it pushed grazing faces back further than the mm-scale gaps between stacked parts, so geometry
// behind a wall won the depth test and bled through the wall's own edges. A units-only bias on the
// lines instead is a fixed number of depth-quantization steps regardless of angle — enough to lift
// an edge off its own coplanar surface without reaching across a gap to a neighbouring part.
export const EDGE_OFFSET_FACTOR = 0;
export const EDGE_OFFSET_UNITS = -1; // negative = toward the camera

/** {@link EdgeOptions} with every field resolved to a concrete value. */
export interface ResolvedOptions {
	forcedColor: THREE.Color | null;
	darken: number;
	width: number;
	thresholdAngle: number;
	distanceFade: boolean;
	maxTriangles: number;
	maxSegments: number;
}

export function resolveOptions(options: EdgeOptions): ResolvedOptions {
	return {
		forcedColor: options.color != null ? new THREE.Color(options.color) : null,
		darken: THREE.MathUtils.clamp(options.darken ?? DEFAULT_DARKEN, 0, 1),
		width: options.width ?? DEFAULT_EDGE_WIDTH,
		thresholdAngle: options.thresholdAngle ?? DEFAULT_THRESHOLD_ANGLE,
		distanceFade: options.distanceFade ?? true,
		maxTriangles: options.maxTriangles ?? DEFAULT_MAX_TRIANGLES,
		maxSegments: options.maxSegments ?? DEFAULT_MAX_SEGMENTS
	};
}
