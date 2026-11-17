import {
	add,
	distance,
	normalize,
	scale,
	subtract,
	type Point3,
	type SketchCurve,
	type SketchItem
} from './curve.js';
import { tessellate } from './nurbs.js';

/** A straight segment of a line or polyline, the unit a dimension is attached to. */
export interface Segment {
	from: Point3;
	to: Point3;
	length: number;
}

/** Empty for a point or a NURBS curve: neither has straight segments to dimension. */
export function segmentsOf(curve: SketchItem): Segment[] {
	if (curve.kind === 'nurbs' || curve.kind === 'point') return [];
	const points = tessellate(curve);
	const segments: Segment[] = [];
	for (let i = 1; i < points.length; i++) {
		segments.push({
			from: points[i - 1],
			to: points[i],
			length: distance(points[i - 1], points[i])
		});
	}
	return segments;
}

export function curveLength(curve: SketchCurve): number {
	const points = tessellate(curve, 48);
	let length = 0;
	for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
	return length;
}

/**
 * Sets one segment to `length` by moving its end point along the segment, and everything after
 * it by the same amount, so the rest of the shape keeps its angles and lengths. On a closed
 * polyline's closing segment the start point moves instead, since its end is the first point.
 *
 * The item comes back unchanged for a point, a NURBS curve, a zero-length segment (it has no
 * direction) or a length that isn't positive.
 */
export function setSegmentLength<T extends SketchItem>(
	curve: T,
	segment: number,
	length: number
): T;
export function setSegmentLength(curve: SketchItem, segment: number, length: number): SketchItem {
	const fixed = curve.kind === 'nurbs' || curve.kind === 'point';
	if (fixed || !(length > 0) || !Number.isFinite(length)) return curve;

	if (curve.kind === 'line') {
		const direction = normalize(subtract(curve.to, curve.from));
		return direction ? { ...curve, to: add(curve.from, scale(direction, length)) } : curve;
	}

	const { points } = curve;
	const start = points[segment];
	const closing = segment === points.length - 1;
	const end = closing ? points[0] : points[segment + 1];
	if (!start || !end || (closing && !curve.closed)) return curve;
	const direction = normalize(subtract(end, start));
	if (!direction) return curve;

	const shift = scale(direction, length - distance(start, end));
	if (closing) {
		const moved = points.slice();
		moved[segment] = subtract(start, shift);
		return { ...curve, points: moved };
	}
	return { ...curve, points: points.map((point, i) => (i > segment ? add(point, shift) : point)) };
}
