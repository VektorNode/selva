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
	 * Force a single edge color for every overlay. When omitted (the default), each overlay derives
	 * its color from its own mesh's material — a darkened tint of the surface — so edges read as the
	 * object's own outline rather than a uniform black frame. Meshes with no readable material color
	 * fall back to {@link DEFAULT_EDGE_COLOR}.
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
	 * Fade an overlay out as its own edges crowd together on screen (default true). Edges draw at a
	 * constant pixel width, so once neighbouring lines sit less than a pixel or two apart they stop
	 * resolving and merge into a dark smear — worst on layered sheet goods, whose millimetre-pitch
	 * laminations are sub-pixel at any normal zoom on a metre-scale part. Fading by edge density
	 * (not by how large the mesh is) returns those parts to a clean shaded read while leaving
	 * sparsely-edged geometry fully drawn at the same distance.
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

/**
 * Below this triangle count extraction runs inline even on the async path — a worker round-trip
 * (copy + transfer + wake) costs more than the extraction itself. Phase 0 measured three's
 * extractor at ~200 ms per 100k triangles; the replacement extractor is ~an order faster, putting
 * 25k triangles well under a frame.
 */
export const INLINE_TRIANGLE_BUDGET = 25_000;

/** CPU byte budget for the cross-solve segment cache (Float32 segment arrays only). */
export const SEGMENT_CACHE_BYTE_BUDGET = 128 * 1024 * 1024;

// Edge-density fade band, as the mean on-screen gap between neighbouring edges in px: fully opaque
// at/above FADE_START_PX, fully gone at/below FADE_END_PX, linear between.
//
// Density, not object size, is what breaks the technical look when zoomed out. A big part whose
// edges have collapsed to sub-pixel spacing is precisely the failure case — every line still draws
// at full width and full opacity, so they merge into a dark smear that reads as "all the interior
// edges showing through". Fading on the *bounding sphere* instead (the previous rule) never fires
// for that part at all, because the sphere still covers most of the viewport.
//
// The band sits just above 1 px: below ~2 px apart, constant-width lines visibly overlap, and by
// 1 px they are a solid fill. Fading out across that range returns the part to its shaded read.
export const FADE_START_PX = 4;
export const FADE_END_PX = 1;

// Edge pull-forward. Units only — deliberately NO slope (factor) term.
//
// The slope term scales with the polygon's dZ/dpixel, which is small head-on but very large at
// grazing angles: on a long surface viewed near edge-on, one pixel spans a lot of depth. Applying it
// to the *surfaces* (the previous strategy) pushed grazing faces back by far more than the
// millimetre-scale gaps between stacked parts, so geometry BEHIND a wall won the depth test against
// the wall's own receded surface and its edges drew straight through — exactly the bleed-through
// this offset exists to prevent.
//
// A units-only bias on the lines is bounded instead: it is a fixed number of depth quantization
// steps regardless of viewing angle, so it can lift an edge off its own coplanar surface without
// ever reaching across the gap to a neighbouring part. 1 unit is the minimum that reliably wins
// z-fighting against the surface the edge was extracted from.
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
