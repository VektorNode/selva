// ============================================================================
// Curves as plain data
// ============================================================================
//
// Coordinates are in the definition's model units and Rhino's axes (Z up), not the viewer's
// metres. Every curve is immutable: an edit returns a new one.

export type Point3 = readonly [x: number, y: number, z: number];

export interface SketchLine {
	kind: 'line';
	from: Point3;
	to: Point3;
}

export interface SketchPolyline {
	kind: 'polyline';
	/** A closed polyline does not repeat its first point. */
	points: readonly Point3[];
	closed: boolean;
}

export interface SketchNurbs {
	kind: 'nurbs';
	degree: number;
	points: readonly Point3[];
	/** One per point; absent when every weight is 1. Points are stored unweighted. */
	weights?: readonly number[];
	/**
	 * The full knot vector, `points.length + degree + 1` long. Rhino stores it without the first
	 * and last knot; `io/rhino.ts` converts.
	 */
	knots: readonly number[];
}

export type SketchCurve = SketchLine | SketchPolyline | SketchNurbs;

export const add = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subtract = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Point3, s: number): Point3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Point3, b: Point3): Point3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
export const distance = (a: Point3, b: Point3): number =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Null for a zero-length vector. */
export function normalize(a: Point3): Point3 | null {
	const length = Math.hypot(a[0], a[1], a[2]);
	return length > 0 ? scale(a, 1 / length) : null;
}

/** Knots for a curve that starts on its first control point and ends on its last. */
export function clampedKnots(pointCount: number, degree: number): number[] {
	const spans = pointCount - degree;
	const knots: number[] = [];
	for (let i = 0; i <= degree; i++) knots.push(0);
	for (let i = 1; i < spans; i++) knots.push(i);
	for (let i = 0; i <= degree; i++) knots.push(spans);
	return knots;
}

/**
 * A curve pulled toward `points` without passing through the inner ones, as Rhino's Curve command
 * draws it. The degree drops when there are too few points to carry it.
 */
export function nurbsFromControlPoints(points: readonly Point3[], degree = 3): SketchNurbs {
	const usable = Math.max(1, Math.min(degree, points.length - 1));
	return {
		kind: 'nurbs',
		degree: usable,
		points: [...points],
		knots: clampedKnots(points.length, usable)
	};
}

/** The points a user can grab: end points, polyline corners, or NURBS control points. */
export function verticesOf(curve: SketchCurve): readonly Point3[] {
	return curve.kind === 'line' ? [curve.from, curve.to] : curve.points;
}

export function withVertex(curve: SketchCurve, index: number, point: Point3): SketchCurve {
	if (curve.kind === 'line') {
		return index === 0 ? { ...curve, from: point } : { ...curve, to: point };
	}
	const points = curve.points.slice();
	points[index] = point;
	return { ...curve, points };
}

/**
 * The curve without one vertex, or null when what is left is no curve: a line, a polyline down
 * to one point, or a NURBS curve with too few points for its knots.
 */
export function withoutVertex(curve: SketchCurve, index: number): SketchCurve | null {
	if (curve.kind === 'line') return null;
	const points = curve.points.filter((_, i) => i !== index);
	if (points.length < 2) return null;
	if (curve.kind === 'polyline') {
		return { ...curve, points, closed: curve.closed && points.length > 2 };
	}
	// Dropping a control point invalidates the knots, so the curve is rebuilt uniform.
	return nurbsFromControlPoints(points, curve.degree);
}

export function mapPoints(curve: SketchCurve, map: (point: Point3) => Point3): SketchCurve {
	if (curve.kind === 'line') return { ...curve, from: map(curve.from), to: map(curve.to) };
	return { ...curve, points: curve.points.map(map) };
}

export function scaleCurve(curve: SketchCurve, factor: number): SketchCurve {
	return factor === 1 ? curve : mapPoints(curve, (point) => scale(point, factor));
}

/** False for a curve Rhino would reject: too few points, zero length, or knots that don't fit. */
export function isValidCurve(curve: SketchCurve): boolean {
	const finite = (point: Point3) => point.every(Number.isFinite);
	if (curve.kind === 'line') {
		return finite(curve.from) && finite(curve.to) && distance(curve.from, curve.to) > 0;
	}
	if (!curve.points.every(finite)) return false;
	if (curve.kind === 'polyline') {
		return curve.points.length >= (curve.closed ? 3 : 2);
	}
	const { degree, points, knots, weights } = curve;
	if (degree < 1 || points.length < degree + 1) return false;
	if (knots.length !== points.length + degree + 1) return false;
	if (weights && (weights.length !== points.length || weights.some((w) => !(w > 0)))) return false;
	for (let i = 1; i < knots.length; i++) {
		if (!(knots[i] >= knots[i - 1])) return false;
	}
	return knots[points.length] > knots[degree];
}

/**
 * Each curve as straight lines, for an input that takes lines only: a polyline becomes its
 * segments, and a NURBS curve is dropped unless it is straight (degree 1).
 */
export function explodeToLines(curves: readonly SketchCurve[]): SketchLine[] {
	const lines: SketchLine[] = [];
	const push = (from: Point3, to: Point3) => {
		if (distance(from, to) > 0) lines.push({ kind: 'line', from, to });
	};
	for (const curve of curves) {
		if (curve.kind === 'line') {
			push(curve.from, curve.to);
			continue;
		}
		if (curve.kind === 'nurbs' && curve.degree !== 1) continue;
		const { points } = curve;
		for (let i = 1; i < points.length; i++) push(points[i - 1], points[i]);
		if (curve.kind === 'polyline' && curve.closed) push(points[points.length - 1], points[0]);
	}
	return lines;
}
