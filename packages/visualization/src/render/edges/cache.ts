import type * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

// ============================================================================
// Per-geometry line-geometry cache (identity-keyed, refcounted)
// ============================================================================

/**
 * Extracted edge geometry, cached per source `BufferGeometry` (and per crease angle, since the
 * angle changes which edges survive). N meshes sharing one geometry — the common case for
 * instanced/repeated parts — get one extraction and one GPU buffer instead of N identical ones.
 *
 * Reference-counted so {@link removeEdges} only disposes a line geometry once its last overlay is
 * gone. The WeakMap keys on the source geometry, so entries vanish with the content they describe;
 * overlays disposed by whole-scene clears (which bypass removeEdges) just leave a refcount behind
 * on an entry that becomes unreachable together with its source geometry.
 */
export interface EdgeGeometryEntry {
	geometry: LineSegmentsGeometry;
	refCount: number;
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
	return lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * SPACING_PERCENTILE))];
}

const edgeGeometryCache = new WeakMap<THREE.BufferGeometry, Map<number, EdgeGeometryEntry>>();

export function cachedEntry(
	geometry: THREE.BufferGeometry,
	thresholdAngle: number
): EdgeGeometryEntry | undefined {
	return edgeGeometryCache.get(geometry)?.get(thresholdAngle);
}

export function storeEntry(
	geometry: THREE.BufferGeometry,
	thresholdAngle: number,
	segments: Float32Array
): EdgeGeometryEntry {
	let byAngle = edgeGeometryCache.get(geometry);
	if (!byAngle) {
		byAngle = new Map();
		edgeGeometryCache.set(geometry, byAngle);
	}
	// LineSegmentsGeometry adopts `segments` as its backing store without copying — sharing the
	// array with the segment cache and with other entries is safe (read-only from here on).
	const lineGeometry = new LineSegmentsGeometry();
	lineGeometry.setPositions(segments);
	const entry: EdgeGeometryEntry = {
		geometry: lineGeometry,
		refCount: 0,
		segmentCount: segments.length / 6,
		edgeSpacing: edgeSpacingOf(segments)
	};
	byAngle.set(thresholdAngle, entry);
	return entry;
}

/** Where an overlay's (possibly shared) line geometry came from, for refcounted disposal. */
interface EdgeOverlayUserData {
	kind: string;
	edgeSource?: THREE.BufferGeometry;
	edgeThresholdAngle?: number;
}

/** Refcounted disposal — only when the last overlay referencing an entry is gone. */
export function releaseEdgeGeometry(overlay: LineSegments2): void {
	const userData = overlay.userData as EdgeOverlayUserData;
	const byAngle = userData.edgeSource && edgeGeometryCache.get(userData.edgeSource);
	const entry =
		userData.edgeThresholdAngle != null ? byAngle?.get(userData.edgeThresholdAngle) : undefined;

	if (!entry || entry.geometry !== overlay.geometry) {
		// Not (or no longer) cache-managed — dispose directly.
		overlay.geometry.dispose();
		return;
	}

	entry.refCount -= 1;
	if (entry.refCount <= 0) {
		entry.geometry.dispose();
		byAngle!.delete(userData.edgeThresholdAngle!);
	}
}
