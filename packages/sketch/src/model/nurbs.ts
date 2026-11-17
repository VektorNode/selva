import {
	add,
	cross,
	distance,
	normalize,
	scale,
	subtract,
	type Point3,
	type SketchCurve,
	type SketchNurbs
} from './curve.js';

// ============================================================================
// Evaluation
// ============================================================================

/** The parameter range the curve is defined over. */
export function nurbsDomain(curve: SketchNurbs): [number, number] {
	return [curve.knots[curve.degree], curve.knots[curve.points.length]];
}

function findSpan(curve: SketchNurbs, t: number): number {
	const { knots, degree, points } = curve;
	const last = points.length - 1;
	if (t >= knots[last + 1]) {
		// The end of the domain belongs to the last span that has any length.
		let span = last;
		while (span > degree && knots[span] === knots[span + 1]) span--;
		return span;
	}
	let low = degree;
	let high = last + 1;
	while (high - low > 1) {
		const mid = (low + high) >> 1;
		if (t < knots[mid]) high = mid;
		else low = mid;
	}
	return low;
}

/** The point at parameter `t`, by de Boor's algorithm on weighted coordinates. */
export function evaluateNurbs(curve: SketchNurbs, t: number): Point3 {
	const { knots, degree, points, weights } = curve;
	const [start, end] = nurbsDomain(curve);
	const u = Math.min(Math.max(t, start), end);
	const span = findSpan(curve, u);

	const d: number[][] = [];
	for (let j = 0; j <= degree; j++) {
		const i = span - degree + j;
		const w = weights?.[i] ?? 1;
		d.push([points[i][0] * w, points[i][1] * w, points[i][2] * w, w]);
	}
	for (let r = 1; r <= degree; r++) {
		for (let j = degree; j >= r; j--) {
			const i = span - degree + j;
			const width = knots[i + degree - r + 1] - knots[i];
			const alpha = width === 0 ? 0 : (u - knots[i]) / width;
			for (let c = 0; c < 4; c++) d[j][c] = (1 - alpha) * d[j - 1][c] + alpha * d[j][c];
		}
	}
	const [x, y, z, w] = d[degree];
	return [x / w, y / w, z / w];
}

/**
 * The curve as a polyline. A NURBS curve gets `samplesPerSpan` points on each knot span, so a
 * kink at a repeated knot is hit exactly; a closed polyline repeats its first point at the end.
 */
export function tessellate(curve: SketchCurve, samplesPerSpan = 16): Point3[] {
	if (curve.kind === 'line') return [curve.from, curve.to];
	if (curve.kind === 'polyline') {
		return curve.closed ? [...curve.points, curve.points[0]] : [...curve.points];
	}
	const { knots, degree, points } = curve;
	const samples = degree === 1 ? 1 : samplesPerSpan;
	const out: Point3[] = [];
	for (let i = degree; i < points.length; i++) {
		const from = knots[i];
		const to = knots[i + 1];
		if (!(to > from)) continue;
		for (let s = 0; s < samples; s++) {
			out.push(evaluateNurbs(curve, from + ((to - from) * s) / samples));
		}
	}
	out.push(evaluateNurbs(curve, nurbsDomain(curve)[1]));
	return out;
}

// ============================================================================
// Arcs
// ============================================================================
//
// A circular arc is exact as a rational quadratic: three control points per span of at most a
// quarter turn, the middle one weighted cos(half the span angle). Lines fit the same form with a
// midpoint of weight 1, so a polyline with arc segments becomes one degree-2 curve.

/** One quadratic span: its end points, and the middle control point with its weight. */
export interface QuadraticSpan {
	from: Point3;
	middle: Point3;
	weight: number;
	to: Point3;
}

export function lineSpan(from: Point3, to: Point3): QuadraticSpan {
	return { from, middle: scale(add(from, to), 0.5), weight: 1, to };
}

/**
 * Spans for an arc around `center` in the plane of `xAxis` and `yAxis` (unit, perpendicular).
 * Angles are radians from `xAxis` toward `yAxis`; a negative `sweep` runs the other way.
 */
export function arcSpans(
	center: Point3,
	xAxis: Point3,
	yAxis: Point3,
	radius: number,
	startAngle: number,
	sweep: number
): QuadraticSpan[] {
	const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
	const step = sweep / count;
	const weight = Math.cos(step / 2);
	const at = (angle: number, r: number): Point3 =>
		add(center, add(scale(xAxis, r * Math.cos(angle)), scale(yAxis, r * Math.sin(angle))));

	const spans: QuadraticSpan[] = [];
	for (let i = 0; i < count; i++) {
		const angle = startAngle + i * step;
		spans.push({
			from: at(angle, radius),
			middle: at(angle + step / 2, radius / weight),
			weight,
			to: at(angle + step, radius)
		});
	}
	return spans;
}

/**
 * Spans for a DXF bulge segment from `from` to `to`: `bulge` is tan(a quarter of the arc's angle),
 * positive when the arc turns counter-clockwise seen against `normal`. Zero is a straight segment.
 */
export function bulgeSpans(
	from: Point3,
	to: Point3,
	bulge: number,
	normal: Point3
): QuadraticSpan[] {
	const chord = distance(from, to);
	const direction = normalize(subtract(to, from));
	if (bulge === 0 || !direction || chord === 0) return [lineSpan(from, to)];

	const left = cross(normal, direction);
	const middle = scale(add(from, to), 0.5);
	const center = add(middle, scale(left, (chord * (1 - bulge * bulge)) / (4 * bulge)));
	const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
	const xAxis = normalize(subtract(from, center));
	if (!xAxis) return [lineSpan(from, to)];
	const spans = arcSpans(center, xAxis, cross(normal, xAxis), radius, 0, 4 * Math.atan(bulge));
	// Pin the ends to the given points, so neighbouring segments meet without rounding gaps.
	spans[0] = { ...spans[0], from };
	spans[spans.length - 1] = { ...spans[spans.length - 1], to };
	return spans;
}

/** Joins spans that meet end to end into one degree-2 curve, with a kink allowed at each join. */
export function nurbsFromQuadraticSpans(spans: readonly QuadraticSpan[]): SketchNurbs {
	const points: Point3[] = [spans[0].from];
	const weights: number[] = [1];
	const knots: number[] = [0, 0, 0];
	spans.forEach((span, i) => {
		points.push(span.middle, span.to);
		weights.push(span.weight, 1);
		knots.push(i + 1, i + 1);
	});
	knots.push(spans.length);
	const rational = weights.some((w) => w !== 1);
	return { kind: 'nurbs', degree: 2, points, knots, ...(rational ? { weights } : {}) };
}

export function arcNurbs(
	center: Point3,
	xAxis: Point3,
	yAxis: Point3,
	radius: number,
	startAngle: number,
	sweep: number
): SketchNurbs {
	return nurbsFromQuadraticSpans(arcSpans(center, xAxis, yAxis, radius, startAngle, sweep));
}
