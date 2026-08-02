import * as THREE from 'three';

/** Crisp boundary/crease edges overlaid on meshes. See the layer README for depth/perf strategy. */
export interface EdgeOptions {
	/** Default: each overlay derives its color from its own mesh's material (see {@link DEFAULT_EDGE_COLOR}). */
	color?: THREE.ColorRepresentation;
	/** How far to darken the derived edge color toward black, 0-1 (default 0.75). No-op when `color` is set. */
	darken?: number;
	/** Edge thickness in CSS px. Default 1.5. */
	width?: number;
	/** Crease angle in degrees; an edge survives only where its two faces differ by more. Default 44. */
	thresholdAngle?: number;
	/**
	 * Fade an overlay out as its own edges crowd together on screen (default true). Edges draw at
	 * constant pixel width, so dense edges (e.g. millimetre-pitch laminations on sheet goods) merge
	 * into a dark smear at normal zoom; fading by edge density rather than mesh size catches that
	 * while leaving sparsely-edged geometry fully drawn.
	 */
	distanceFade?: boolean;
	/**
	 * Skip meshes above this triangle count entirely (default 4M) — extraction time is linear in
	 * triangles, and past this bound even the worker path burns seconds for a look the screen-space
	 * fallback approximates at constant cost. Skipped meshes are tagged
	 * `userData.edgesSkipped = 'triangle-cap'`.
	 */
	maxTriangles?: number;
	/**
	 * Above this many extracted segments (default 2M), an overlay drops the distance fade and renders
	 * opaque instead — millions of blended fat-line quads are a fill-rate cliff; opaque ones aren't.
	 */
	maxSegments?: number;
}

/** Tag on edge overlays so pick/fit/clear logic can recognize and skip or dispose them. */
export const EDGE_USERDATA_KIND = 'edge-overlay';

/** `userData.edgesSkipped` value; see {@link EdgeOptions.maxTriangles}. */
export const EDGES_SKIPPED_TRIANGLE_CAP = 'triangle-cap';

export const DEFAULT_EDGE_COLOR = 0x222222;
const DEFAULT_EDGE_WIDTH = 1.5;
const DEFAULT_THRESHOLD_ANGLE = 44;
const DEFAULT_DARKEN = 0.75;
const DEFAULT_MAX_TRIANGLES = 4_000_000;
const DEFAULT_MAX_SEGMENTS = 2_000_000;

// Below this triangle count a worker round-trip would cost more than the extraction itself, so it
// runs inline even on the async path.
export const INLINE_TRIANGLE_BUDGET = 25_000;

// Fade band as mean on-screen gap between neighbouring edges, in px: opaque at/above
// FADE_START_PX, gone at/below FADE_END_PX, linear between. Density-based rather than
// mesh/bounding-sphere-based, because a big part with sub-pixel edge spacing still draws every
// line at full width — the old bounding-sphere rule missed that (the sphere still covers most of
// the viewport). Band sits just above 1px, where constant-width lines start visibly overlapping.
export const FADE_START_PX = 4;
export const FADE_END_PX = 1;

// Units-only pull-forward, deliberately no slope (factor) term: a slope term scales with the
// polygon's dZ/dpixel, huge at grazing angles, and applied to surfaces (the old strategy) it
// pushed grazing faces back further than the mm-scale gaps between stacked parts — geometry
// behind a wall then won the depth test and bled through the wall's own edges. A fixed
// quantization-step bias on the lines instead lifts an edge off its own surface without reaching
// across a gap to a neighbouring part.
//
// This bias is only safe as long as a depth ULP stays small, which is what near-plane.ts's dynamic
// near-plane fitter guarantees. Weakening that fit makes this bias start to bleed.
export const EDGE_OFFSET_FACTOR = 0;
export const EDGE_OFFSET_UNITS = -1; // negative = toward the camera

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
