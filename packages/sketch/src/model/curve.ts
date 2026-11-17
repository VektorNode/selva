// ============================================================================
// Curves and points as plain data
// ============================================================================
//
// Coordinates are in the definition's model units and Rhino's axes (Z up), not the viewer's
// metres. Every item is immutable: an edit returns a new one.

export type Point3 = readonly [x: number, y: number, z: number];

/**
 * What an item carries besides its shape. Every edit keeps all three.
 */
export interface ItemTags {
	/** Stable while the item is edited in the browser. Not sent to Rhino. */
	id?: string;
	/**
	 * The Grasshopper branch the item sits in, as `[0, 1]` for `{0;1}`. Absent is `{0}`. Items
	 * that share a path arrive as one list, so a path per element groups its items for the
	 * definition.
	 */
	path?: readonly number[];
	/**
	 * Text keyed by name, such as a role or a height. Sent to Rhino as the object's user strings,
	 * which a Get Geometry input carries and a Get Line or Get Point input does not.
	 */
	attributes?: Readonly<Record<string, string>>;
}

export interface SketchPoint extends ItemTags {
	kind: 'point';
	at: Point3;
}

export interface SketchLine extends ItemTags {
	kind: 'line';
	from: Point3;
	to: Point3;
}

export interface SketchPolyline extends ItemTags {
	kind: 'polyline';
	/** A closed polyline does not repeat its first point. */
	points: readonly Point3[];
	closed: boolean;
}

export interface SketchNurbs extends ItemTags {
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

/** Anything a geometry input can hold that this package draws. */
export type SketchItem = SketchCurve | SketchPoint;

export const isPoint = (item: SketchItem): item is SketchPoint => item.kind === 'point';
export const isCurve = (item: SketchItem): item is SketchCurve => item.kind !== 'point';

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

/** An item's id, path and attributes, to carry over to an item made from it. */
export function tagsOf(item: ItemTags): ItemTags {
	const tags: ItemTags = {};
	if (item.id !== undefined) tags.id = item.id;
	if (item.path !== undefined) tags.path = item.path;
	if (item.attributes !== undefined) tags.attributes = item.attributes;
	return tags;
}

/** A path as Grasshopper writes it: `[0, 1]` is `{0;1}`, and no path is `{0}`. */
export function pathKey(path: readonly number[] | undefined): string {
	return `{${(path ?? [0]).join(';')}}`;
}

/** Null for text that is not a path such as `{0}` or `{0;1}`. */
export function parsePath(key: string): number[] | null {
	const match = /^\{(-?\d+(?:;-?\d+)*)?\}$/.exec(key.trim());
	if (!match) return null;
	return match[1] ? match[1].split(';').map(Number) : [];
}

/** The items by branch, in the order each branch first appears. */
export function groupByPath<T extends ItemTags>(items: readonly T[]): Map<string, T[]> {
	const branches = new Map<string, T[]>();
	for (const item of items) {
		const key = pathKey(item.path);
		const branch = branches.get(key);
		if (branch) branch.push(item);
		else branches.set(key, [item]);
	}
	return branches;
}

/** The points a user can grab: a point, end points, polyline corners, or NURBS control points. */
export function verticesOf(item: SketchItem): readonly Point3[] {
	if (item.kind === 'point') return [item.at];
	return item.kind === 'line' ? [item.from, item.to] : item.points;
}

export function withVertex(item: SketchItem, index: number, point: Point3): SketchItem {
	if (item.kind === 'point') return { ...item, at: point };
	if (item.kind === 'line') {
		return index === 0 ? { ...item, from: point } : { ...item, to: point };
	}
	const points = item.points.slice();
	points[index] = point;
	return { ...item, points };
}

/**
 * The item without one vertex, or null when nothing drawable is left: a point, a line, a polyline
 * down to one point, or a NURBS curve with too few points for its knots.
 */
export function withoutVertex(curve: SketchItem, index: number): SketchItem | null {
	if (curve.kind === 'point' || curve.kind === 'line') return null;
	const points = curve.points.filter((_, i) => i !== index);
	if (points.length < 2) return null;
	if (curve.kind === 'polyline') {
		return { ...curve, points, closed: curve.closed && points.length > 2 };
	}
	// Dropping a control point invalidates the knots, so the curve is rebuilt uniform.
	return { ...tagsOf(curve), ...nurbsFromControlPoints(points, curve.degree) };
}

export function mapPoints<T extends SketchItem>(item: T, map: (point: Point3) => Point3): T;
export function mapPoints(item: SketchItem, map: (point: Point3) => Point3): SketchItem {
	if (item.kind === 'point') return { ...item, at: map(item.at) };
	if (item.kind === 'line') return { ...item, from: map(item.from), to: map(item.to) };
	return { ...item, points: item.points.map(map) };
}

export function scaleItem<T extends SketchItem>(item: T, factor: number): T {
	return factor === 1 ? item : mapPoints(item, (point) => scale(point, factor));
}

/** False for an item Rhino would reject: see {@link isValidCurve}; a point needs finite numbers. */
export function isValidItem(item: SketchItem): boolean {
	return item.kind === 'point' ? item.at.every(Number.isFinite) : isValidCurve(item);
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
 * segments, and a point or a NURBS curve is dropped unless the curve is straight (degree 1).
 */
export function explodeToLines(items: readonly SketchItem[]): SketchLine[] {
	const lines: SketchLine[] = [];
	for (const curve of items) {
		if (curve.kind === 'point') continue;
		if (curve.kind === 'line') {
			if (distance(curve.from, curve.to) > 0) lines.push(curve);
			continue;
		}
		if (curve.kind === 'nurbs' && curve.degree !== 1) continue;
		// The segments keep the path and attributes, not the id: one id would name several lines.
		const { id: _, ...tags } = tagsOf(curve);
		const push = (from: Point3, to: Point3) => {
			if (distance(from, to) > 0) lines.push({ ...tags, kind: 'line', from, to });
		};
		const { points } = curve;
		for (let i = 1; i < points.length; i++) push(points[i - 1], points[i]);
		if (curve.kind === 'polyline' && curve.closed) push(points[points.length - 1], points[0]);
	}
	return lines;
}
