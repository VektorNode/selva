import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// ============================================================================
// Line geometry construction
// ============================================================================
//
// This used to be a refcounted, identity-keyed cache of `LineSegmentsGeometry` per source
// `BufferGeometry`. It was removed on 2026-07-30 after measurement (see below); what is left
// is the part that was doing the work — building the line geometry and describing it.
//
// Why the cache went, in numbers:
//   - In the real solve loop it hit 0 out of 80 lookups. `clearScene` releases edge geometry per
//     source geometry, so every solve started cold. It only hit (76/80) when edges were re-applied
//     WITHOUT a scene clear — toggling edges on a stable scene.
//   - What it uniquely saved over the content-keyed segment cache (`extraction.ts`) is exactly
//     this file's `buildLineGeometry`: 3.8 ms on a 96k-triangle mesh, against 71 ms for the
//     extraction the segment cache already absorbs. ~5% of the cost.
//   - It cost a WeakMap, a refcount protocol, a `clearScene` hook, and one live memory leak (F1):
//     the WeakMap's "entries vanish with their source geometry" premise was falsified by the
//     cross-solve geometry cache holding sources reachable forever, so line geometries with
//     resident GPU buffers accumulated without bound — 400 live entries where 8 were expected.
//
// The segment cache remains and is doing the heavy lifting: extraction results are keyed by
// content, so a rebuilt-but-identical geometry still skips the kernel.

/** An extracted edge overlay's geometry plus the measurements the overlay needs to render it. */
export interface EdgeGeometryEntry {
	geometry: LineSegmentsGeometry;
	segmentCount: number;
	/**
	 * Mean world-space spacing between this overlay's edges: the characteristic distance at which
	 * neighbouring lines sit. Drives the density fade (see `enableDistanceFade`) — an overlay fades
	 * when *this* projects below a pixel, which is when its lines start merging, regardless of how
	 * large the mesh itself is on screen.
	 *
	 * Estimated as area/length: total edge length L spread over the mesh's projected extent A behaves
	 * like a set of parallel lines A/L apart. Infinity for degenerate cases (no length, no extent), so
	 * they never fade.
	 */
	edgeSpacing: number;
}

/**
 * Fraction of segments allowed to be shorter than the reported spacing. A low percentile tracks the
 * *fine* detail rather than the average: real parts mix a handful of long silhouette edges with many
 * short ones, and it is the short ones that merge first.
 */
const SPACING_PERCENTILE = 0.15;

/** Cap on segments sampled for the percentile — a stride keeps this O(1) on millions of segments. */
const SPACING_SAMPLE_LIMIT = 4096;

/**
 * Characteristic spacing between an overlay's edges, in world units: the
 * {@link SPACING_PERCENTILE} quantile of segment length.
 *
 * Segment length is the right proxy for spacing on the geometry this targets. Layered sheet goods —
 * plywood laminations, stacked panels — produce a ladder of short segments spanning each layer's
 * thickness, so the short-segment population *is* the layer pitch, which is exactly the distance
 * that collapses below a pixel and smears the lines together.
 *
 * A quantile rather than a mean because the two populations differ by orders of magnitude: a 10 m
 * part with 1 mm laminations mixes lengths at 1:10000, and any average of those sits far above the
 * pitch (so the laminations never fade) while still far below the outline (so the outline fades
 * early). Taking a low quantile lets the dense detail drive the fade without the silhouette edges
 * dragging it up. Infinity when there is nothing to measure, which never fades.
 */
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

/**
 * Build the renderable line geometry for a set of extracted segments.
 *
 * Every overlay gets its own `LineSegmentsGeometry`, owned by the overlay and disposed with it —
 * no sharing, no refcount, no cache. `LineSegmentsGeometry` adopts `segments` as its backing store
 * without copying, so the array itself is still safely shared with the segment cache (read-only
 * from here on) and across any number of overlays built from the same content.
 */
export function buildLineGeometry(segments: Float32Array): EdgeGeometryEntry {
	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(segments);
	return {
		geometry,
		segmentCount: segments.length / 6,
		edgeSpacing: edgeSpacingOf(segments)
	};
}
