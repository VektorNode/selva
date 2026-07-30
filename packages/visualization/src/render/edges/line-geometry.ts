import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// ============================================================================
// Line geometry construction
// ============================================================================
//
// No identity cache here on purpose: an earlier refcounted WeakMap cache (keyed per source
// BufferGeometry) leaked ~400 live GPU entries where 8 were expected, because the cross-solve
// geometry cache holds sources reachable forever, falsifying the WeakMap's "entries vanish with
// their source" premise. It also barely helped (0/80 real-loop hits; the ~5% it saved on top of
// the content-keyed segment cache in extraction.ts wasn't worth the leak). Removed 2026-07-30 —
// the segment cache does the heavy lifting instead.

/** An extracted edge overlay's geometry plus the measurements the overlay needs to render it. */
export interface EdgeGeometryEntry {
	geometry: LineSegmentsGeometry;
	segmentCount: number;
	/**
	 * Mean world-space spacing between this overlay's edges. Drives the density fade (see
	 * `enableDistanceFade`): fades when this projects below a pixel, regardless of how large the
	 * mesh is on screen. Infinity for degenerate cases (no length, no extent) — never fades.
	 */
	edgeSpacing: number;
}

// Low percentile of segment length tracks the *fine* detail rather than the average: a low
// quantile (not mean) is needed because real parts mix a few long silhouette edges with many
// short ones at orders-of-magnitude different scale (e.g. 1mm laminations on a 10m part) — an
// average would sit between the two and never trigger the fade for either.
const SPACING_PERCENTILE = 0.15;

/** Cap on segments sampled for the percentile — a stride keeps this O(1) on millions of segments. */
const SPACING_SAMPLE_LIMIT = 4096;

/** Characteristic spacing between an overlay's edges, in world units ({@link SPACING_PERCENTILE} quantile of segment length). */
function edgeSpacingOf(segments: Float32Array): number {
	const segmentCount = Math.floor(segments.length / 6);
	if (segmentCount === 0) return Infinity;

	const stride = Math.max(1, Math.ceil(segmentCount / SPACING_SAMPLE_LIMIT));
	const lengths: number[] = [];
	for (let s = 0; s < segmentCount; s += stride) {
		const i = s * 6;
		const length = Math.hypot(
			segments[i + 3] - segments[i],
			segments[i + 4] - segments[i + 1],
			segments[i + 5] - segments[i + 2]
		);
		if (length > 0) lengths.push(length);
	}
	if (lengths.length === 0) return Infinity;

	lengths.sort((a, b) => a - b);
	return lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * SPACING_PERCENTILE))]!;
}

// Every overlay gets its own LineSegmentsGeometry, owned and disposed with it — no sharing, no
// cache (see the note above). LineSegmentsGeometry adopts `segments` as its backing store without
// copying, so the array is still safely shared with the segment cache (read-only from here on).
export function buildLineGeometry(segments: Float32Array): EdgeGeometryEntry {
	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(segments);
	return {
		geometry,
		segmentCount: segments.length / 6,
		edgeSpacing: edgeSpacingOf(segments)
	};
}
