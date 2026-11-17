import {
	add,
	clampedKnots,
	cross,
	isValidCurve,
	normalize,
	scale,
	type Point3,
	type SketchCurve,
	type SketchNurbs
} from '../model/curve.js';
import {
	arcNurbs,
	bulgeSpans,
	nurbsFromQuadraticSpans,
	type QuadraticSpan
} from '../model/nurbs.js';

// ============================================================================
// DXF curves
// ============================================================================
//
// An ASCII DXF is a flat list of (group code, value) line pairs. Code 0 starts a section, an
// entity or a table entry; the codes after it belong to that thing until the next 0.
//
// Read: LINE, LWPOLYLINE, POLYLINE (2D and 3D), SPLINE with control points, ARC, CIRCLE.
// Skipped and counted in `skipped`: everything else, including INSERT (block references are not
// expanded), ELLIPSE, and splines that carry fit points only.
//
// LWPOLYLINE, 2D POLYLINE, ARC and CIRCLE store their points in the entity's own plane (OCS),
// found from the extrusion direction (210/220/230) by DXF's arbitrary axis algorithm. A mirrored
// drawing has extrusion (0,0,-1), which flips X, so the plane cannot be ignored.

export interface DxfImport {
	/** In the file's own units. */
	curves: SketchCurve[];
	/** From `$INSUNITS`; null when the file is unitless or doesn't say. */
	metersPerUnit: number | null;
	/** Entity type to how many were not read. */
	skipped: Record<string, number>;
}

/** `$INSUNITS` code to metres. */
const INSUNITS_METERS: Record<number, number> = {
	1: 0.0254, // inches
	2: 0.3048, // feet
	3: 1609.344, // miles
	4: 1e-3, // millimetres
	5: 1e-2, // centimetres
	6: 1, // metres
	7: 1000, // kilometres
	8: 0.0254e-6, // microinches
	9: 0.0254e-3, // mils
	10: 0.9144, // yards
	11: 1e-10, // angstroms
	12: 1e-9, // nanometres
	13: 1e-6, // microns
	14: 0.1, // decimetres
	15: 10, // decametres
	16: 100, // hectometres
	17: 1e9 // gigametres
};

interface Pair {
	code: number;
	value: string;
}

type Entity = Pair[];

const POLYLINE_CLOSED = 1;
const POLYLINE_3D = 8;
const POLYLINE_MESH = 16 | 64;
const VERTEX_SPLINE_FRAME = 16;

function readPairs(text: string): Pair[] {
	const lines = text.split(/\r\n|\r|\n/);
	const pairs: Pair[] = [];
	for (let i = 0; i + 1 < lines.length; i += 2) {
		const code = Number.parseInt(lines[i], 10);
		if (Number.isNaN(code)) continue;
		pairs.push({ code, value: lines[i + 1].trim() });
	}
	return pairs;
}

const numbers = (entity: Entity, code: number): number[] =>
	entity.filter((pair) => pair.code === code).map((pair) => Number.parseFloat(pair.value));

const number = (entity: Entity, code: number, fallback = 0): number => {
	const value = numbers(entity, code)[0];
	return Number.isFinite(value) ? value : fallback;
};

const point = (entity: Entity, base: number): Point3 => [
	number(entity, base),
	number(entity, base + 10),
	number(entity, base + 20)
];

interface Plane {
	x: Point3;
	y: Point3;
	normal: Point3;
}

function entityPlane(entity: Entity): Plane {
	const normal = normalize([number(entity, 210), number(entity, 220), number(entity, 230, 1)]) ?? [
		0, 0, 1
	];
	const nearZ = Math.abs(normal[0]) < 1 / 64 && Math.abs(normal[1]) < 1 / 64;
	const x = normalize(cross(nearZ ? [0, 1, 0] : [0, 0, 1], normal)) ?? [1, 0, 0];
	return { x, y: cross(normal, x), normal };
}

const toWorld = (plane: Plane, [x, y, z]: Point3): Point3 =>
	add(add(scale(plane.x, x), scale(plane.y, y)), scale(plane.normal, z));

interface PolyVertex {
	point: Point3;
	bulge: number;
}

function polylineCurve(
	vertices: PolyVertex[],
	closed: boolean,
	normal: Point3
): SketchCurve | null {
	if (vertices.length < 2) return null;
	const points = vertices.map((vertex) => vertex.point);
	// The last vertex's bulge shapes the closing segment, so it only counts on a closed polyline.
	const bulged = vertices.some(
		(vertex, i) => vertex.bulge !== 0 && (closed || i < points.length - 1)
	);
	if (!bulged) {
		return { kind: 'polyline', points, closed: closed && points.length > 2 };
	}
	const spans: QuadraticSpan[] = [];
	const last = closed ? points.length : points.length - 1;
	for (let i = 0; i < last; i++) {
		spans.push(
			...bulgeSpans(points[i], points[(i + 1) % points.length], vertices[i].bulge, normal)
		);
	}
	return nurbsFromQuadraticSpans(spans);
}

function lwPolyline(entity: Entity): SketchCurve | null {
	const plane = entityPlane(entity);
	const elevation = number(entity, 38);
	const vertices: { x: number; y: number; bulge: number }[] = [];
	for (const { code, value } of entity) {
		const parsed = Number.parseFloat(value);
		if (code === 10) vertices.push({ x: parsed, y: 0, bulge: 0 });
		else if (code === 20 && vertices.length) vertices[vertices.length - 1].y = parsed;
		else if (code === 42 && vertices.length) vertices[vertices.length - 1].bulge = parsed;
	}
	return polylineCurve(
		vertices.map((v) => ({ point: toWorld(plane, [v.x, v.y, elevation]), bulge: v.bulge })),
		(number(entity, 70) & POLYLINE_CLOSED) !== 0,
		plane.normal
	);
}

function heavyPolyline(entity: Entity, vertexEntities: Entity[]): SketchCurve | null {
	const flags = number(entity, 70);
	if (flags & POLYLINE_MESH) return null;
	const is3d = (flags & POLYLINE_3D) !== 0;
	const plane = entityPlane(entity);
	const elevation = number(entity, 30);
	const vertices = vertexEntities
		// A spline-fit polyline keeps its control frame as extra vertices that are not on the curve.
		.filter((vertex) => (number(vertex, 70) & VERTEX_SPLINE_FRAME) === 0)
		.map((vertex) => ({
			point: is3d
				? point(vertex, 10)
				: toWorld(plane, [number(vertex, 10), number(vertex, 20), elevation]),
			bulge: is3d ? 0 : number(vertex, 42)
		}));
	return polylineCurve(vertices, (flags & POLYLINE_CLOSED) !== 0, plane.normal);
}

function spline(entity: Entity): SketchNurbs | null {
	const xs = numbers(entity, 10);
	const ys = numbers(entity, 20);
	const zs = numbers(entity, 30);
	const points: Point3[] = xs.map((x, i) => [x, ys[i] ?? 0, zs[i] ?? 0]);
	const degree = number(entity, 71, 3);
	if (points.length < degree + 1 || degree < 1) return null;

	let knots = numbers(entity, 40);
	if (knots.length !== points.length + degree + 1) knots = clampedKnots(points.length, degree);
	const weights = numbers(entity, 41);
	const rational = weights.length === points.length && weights.some((w) => w !== 1);
	return { kind: 'nurbs', degree, points, knots, ...(rational ? { weights } : {}) };
}

function arc(entity: Entity, full: boolean): SketchNurbs | null {
	const plane = entityPlane(entity);
	const radius = number(entity, 40);
	if (!(radius > 0)) return null;
	const start = full ? 0 : (number(entity, 50) * Math.PI) / 180;
	let sweep = full ? 2 * Math.PI : (number(entity, 51) * Math.PI) / 180 - start;
	// DXF arcs always run counter-clockwise from start to end.
	while (sweep <= 0) sweep += 2 * Math.PI;
	return arcNurbs(toWorld(plane, point(entity, 10)), plane.x, plane.y, radius, start, sweep);
}

/**
 * Reads the curves out of an ASCII DXF's ENTITIES section.
 *
 * @throws {Error} For a binary DXF, which has no line pairs to read.
 */
export function parseDxf(text: string): DxfImport {
	if (text.startsWith('AutoCAD Binary DXF')) {
		throw new Error('Binary DXF is not supported: save the file as ASCII DXF.');
	}
	const pairs = readPairs(text);
	const result: DxfImport = { curves: [], metersPerUnit: null, skipped: {} };
	const skip = (type: string) => {
		result.skipped[type] = (result.skipped[type] ?? 0) + 1;
	};
	const keep = (type: string, curve: SketchCurve | null) => {
		if (curve && isValidCurve(curve)) result.curves.push(curve);
		else skip(type);
	};

	let section = '';
	let i = 0;
	const nextEntity = (): Entity => {
		const start = i++;
		while (i < pairs.length && pairs[i].code !== 0) i++;
		return pairs.slice(start, i);
	};

	while (i < pairs.length) {
		const pair = pairs[i];
		if (pair.code === 9 && pair.value === '$INSUNITS' && section === 'HEADER') {
			const code = Number.parseInt(pairs[i + 1]?.value ?? '', 10);
			result.metersPerUnit = INSUNITS_METERS[code] ?? null;
			i++;
			continue;
		}
		if (pair.code !== 0) {
			i++;
			continue;
		}
		if (pair.value === 'SECTION') {
			section = pairs[i + 1]?.code === 2 ? pairs[i + 1].value : '';
			i += 2;
			continue;
		}
		if (pair.value === 'ENDSEC') {
			section = '';
			i++;
			continue;
		}
		if (section !== 'ENTITIES') {
			i++;
			continue;
		}

		const entity = nextEntity();
		const type = entity[0].value;
		switch (type) {
			case 'LINE':
				keep(type, { kind: 'line', from: point(entity, 10), to: point(entity, 11) });
				break;
			case 'LWPOLYLINE':
				keep(type, lwPolyline(entity));
				break;
			case 'POLYLINE': {
				const vertices: Entity[] = [];
				while (i < pairs.length && pairs[i].value === 'VERTEX') vertices.push(nextEntity());
				if (pairs[i]?.value === 'SEQEND') nextEntity();
				keep(type, heavyPolyline(entity, vertices));
				break;
			}
			case 'SPLINE':
				keep(type, spline(entity));
				break;
			case 'ARC':
				keep(type, arc(entity, false));
				break;
			case 'CIRCLE':
				keep(type, arc(entity, true));
				break;
			default:
				skip(type);
		}
	}
	return result;
}
