import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// ============================================================================
// Line geometry construction
// ============================================================================

// No cache here. An earlier WeakMap keyed per source BufferGeometry leaked ~400 live GPU entries
// where 8 were expected — entries never vanished with their source — and measured 0/80 hits in a
// real scrubbing loop. Every overlay builds and owns its own line geometry.

export interface EdgeGeometryEntry {
	geometry: LineSegmentsGeometry;
	segmentCount: number;
	/** {@link SPACING_PERCENTILE} quantile of segment length; drives the density fade in overlay.ts. */
	edgeSpacing: number;
}

// A low quantile (not mean) tracks the *fine* detail: real parts mix a few long silhouette edges
// with many short ones at orders-of-magnitude different scale (e.g. 1mm laminations on a 10m
// part) — an average would sit between the two and never trigger the fade for either.
const SPACING_PERCENTILE = 0.15;

// Stride sampling keeps this O(1) on millions of segments.
const SPACING_SAMPLE_LIMIT = 4096;

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

// LineSegmentsGeometry adopts `segments` as its backing store without copying — treat it as
// read-only from here on.
export function buildLineGeometry(segments: Float32Array): EdgeGeometryEntry {
	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(segments);
	return {
		geometry,
		segmentCount: segments.length / 6,
		edgeSpacing: edgeSpacingOf(segments)
	};
}
