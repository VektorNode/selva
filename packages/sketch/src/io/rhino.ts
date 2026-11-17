import type { Curve, NurbsCurve, RhinoModule } from 'rhino3dm';
import {
	isValidCurve,
	type Point3,
	type SketchCurve,
	type SketchLine,
	type SketchNurbs
} from '../model/curve.js';

// ============================================================================
// Curves to and from Rhino
// ============================================================================
//
// Rhino.Compute reads a Get Geometry value as Rhino's own archive JSON, the output of
// `CommonObject.encode()`: `{ version, archive3dm, opennurbs, data: "<base64>" }`. Only rhino3dm
// can write it, so every function here takes the loaded module. A Get Line value is plain JSON
// and needs none.
//
// rhino3dm objects live on the WASM heap and are never garbage collected: each one made here is
// deleted before the function returns.
//
// Two conventions differ from `model/`:
// - Rhino's knot vector leaves out the first and last knot of the textbook one.
// - `points().get/set` use homogeneous coordinates: `[x*w, y*w, z*w, w]`.

/** What `CommonObject.encode()` returns and Rhino.Compute's Get Geometry reads. */
export interface RhinoArchive {
	version: number;
	archive3dm: number;
	opennurbs: number;
	data: string;
}

/** A Get Line value, as Rhino.Compute deserializes `Rhino.Geometry.Line`. */
export interface RhinoLineJson {
	From: { X: number; Y: number; Z: number };
	To: { X: number; Y: number; Z: number };
}

interface Deletable {
	delete(): void;
}

const point3 = (p: ArrayLike<number>): Point3 => [p[0], p[1], p[2]];
const array = (p: Point3): number[] => [p[0], p[1], p[2]];

export function isRhinoArchive(value: unknown): value is RhinoArchive {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as RhinoArchive).data === 'string' &&
		'archive3dm' in value
	);
}

function toRhinoCurve(rhino: RhinoModule, curve: SketchCurve): Curve {
	if (curve.kind === 'line') return new rhino.LineCurve(array(curve.from), array(curve.to));
	if (curve.kind === 'polyline') {
		const points = curve.points.map(array);
		if (curve.closed) points.push(array(curve.points[0]));
		return new rhino.PolylineCurve(points);
	}

	const { degree, points, weights, knots } = curve;
	const nurbs = new rhino.NurbsCurve(3, weights !== undefined, degree + 1, points.length);
	const cvs = nurbs.points();
	points.forEach((p, i) => {
		const w = weights?.[i] ?? 1;
		cvs.set(i, [p[0] * w, p[1] * w, p[2] * w, w]);
	});
	const rhinoKnots = nurbs.knots();
	for (let i = 1; i < knots.length - 1; i++) rhinoKnots.set(i - 1, knots[i]);
	return nurbs;
}

/** @throws {Error} When the curve is one Rhino would reject, such as a zero-length line. */
export function encodeCurve(rhino: RhinoModule, curve: SketchCurve): RhinoArchive {
	if (!isValidCurve(curve)) throw new Error(`Cannot encode an invalid ${curve.kind}.`);
	const rhinoCurve = toRhinoCurve(rhino, curve);
	try {
		// rhino3dm types `encode()` as void.
		return rhinoCurve.encode() as unknown as RhinoArchive;
	} finally {
		(rhinoCurve as unknown as Deletable).delete();
	}
}

function fromNurbs(nurbs: NurbsCurve): SketchCurve {
	const degree = nurbs.order - 1;
	const cvs = nurbs.points();
	const points: Point3[] = [];
	const weights: number[] = [];
	for (let i = 0; i < cvs.count; i++) {
		const [x, y, z, w] = cvs.get(i);
		points.push([x / w, y / w, z / w]);
		weights.push(w);
	}
	// A degree-1 curve is a polyline whatever Rhino stored it as.
	if (degree === 1) {
		const closed = points.length > 3 && samePoint(points[0], points[points.length - 1]);
		return { kind: 'polyline', points: closed ? points.slice(0, -1) : points, closed };
	}
	const list = nurbs.knots();
	const knots = [list.superfluousKnot(true), ...list.toList(), list.superfluousKnot(false)];
	const curve: SketchNurbs = { kind: 'nurbs', degree, points, knots };
	return nurbs.isRational ? { ...curve, weights } : curve;
}

const samePoint = (a: Point3, b: Point3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Any Rhino curve as one of ours. Arcs, circles and polycurves come back as NURBS. */
function fromRhinoCurve(rhino: RhinoModule, curve: Curve): SketchCurve | null {
	if (curve instanceof rhino.LineCurve) {
		const { from, to } = curve.line;
		return { kind: 'line', from: point3(from), to: point3(to) };
	}
	if (curve instanceof rhino.PolylineCurve) {
		const points: Point3[] = [];
		for (let i = 0; i < curve.pointCount; i++) points.push(point3(curve.point(i)));
		const closed = points.length > 3 && samePoint(points[0], points[points.length - 1]);
		return { kind: 'polyline', points: closed ? points.slice(0, -1) : points, closed };
	}
	if (curve instanceof rhino.NurbsCurve) return fromNurbs(curve);

	const nurbs = curve.toNurbsCurve();
	if (!nurbs) return null;
	try {
		return fromNurbs(nurbs);
	} finally {
		(nurbs as unknown as Deletable).delete();
	}
}

/** Null when the archive holds something other than a curve, or cannot be read. */
export function decodeCurve(rhino: RhinoModule, archive: RhinoArchive): SketchCurve | null {
	let decoded: unknown;
	try {
		decoded = rhino.CommonObject.decode(archive);
	} catch {
		return null;
	}
	if (!decoded) return null;
	try {
		if (!(decoded instanceof rhino.Curve)) return null;
		const curve = fromRhinoCurve(rhino, decoded);
		return curve && isValidCurve(curve) ? curve : null;
	} finally {
		(decoded as Deletable).delete?.();
	}
}

export function lineToRhinoJson(line: SketchLine): RhinoLineJson {
	const xyz = ([X, Y, Z]: Point3) => ({ X, Y, Z });
	return { From: xyz(line.from), To: xyz(line.to) };
}

/** Null for anything that is not a `{ From, To }` line with finite coordinates. */
export function lineFromRhinoJson(value: unknown): SketchLine | null {
	const read = (p: unknown): Point3 | null => {
		const { X, Y, Z } = (p ?? {}) as Record<string, unknown>;
		return [X, Y, Z].every((n) => typeof n === 'number' && Number.isFinite(n))
			? [X as number, Y as number, Z as number]
			: null;
	};
	const { From, To } = (value ?? {}) as Record<string, unknown>;
	const from = read(From);
	const to = read(To);
	return from && to ? { kind: 'line', from, to } : null;
}

export interface File3dmImport {
	/** In the file's own units. */
	curves: SketchCurve[];
	/** Null when the file's unit system has no fixed length, such as custom units. */
	metersPerUnit: number | null;
	/** Objects that are not curves: surfaces, meshes, points, blocks. */
	skipped: number;
}

function metersPerFileUnit(rhino: RhinoModule, unit: unknown): number | null {
	const U = rhino.UnitSystem;
	const table: [unknown, number][] = [
		[U.Angstroms, 1e-10],
		[U.Nanometers, 1e-9],
		[U.Microns, 1e-6],
		[U.Millimeters, 1e-3],
		[U.Centimeters, 1e-2],
		[U.Decimeters, 0.1],
		[U.Meters, 1],
		[U.Dekameters, 10],
		[U.Hectometers, 100],
		[U.Kilometers, 1000],
		[U.Megameters, 1e6],
		[U.Gigameters, 1e9],
		[U.Microinches, 0.0254e-6],
		[U.Mils, 0.0254e-3],
		[U.Inches, 0.0254],
		[U.Feet, 0.3048],
		[U.Yards, 0.9144],
		[U.Miles, 1609.344],
		[U.NauticalMiles, 1852]
	];
	return table.find(([key]) => key === unit)?.[1] ?? null;
}

/**
 * Reads the curves out of a `.3dm` file. Block instances are not expanded.
 *
 * @throws {Error} When the bytes are not a readable `.3dm`.
 */
export function read3dm(rhino: RhinoModule, bytes: Uint8Array): File3dmImport {
	const file = rhino.File3dm.fromByteArray(bytes);
	if (!file) throw new Error('Not a readable .3dm file.');
	try {
		const result: File3dmImport = {
			curves: [],
			metersPerUnit: metersPerFileUnit(rhino, file.settings().modelUnitSystem),
			skipped: 0
		};
		const objects = file.objects();
		for (let i = 0; i < objects.count; i++) {
			const geometry = objects.get(i).geometry();
			const curve = geometry instanceof rhino.Curve ? fromRhinoCurve(rhino, geometry) : null;
			if (curve && isValidCurve(curve)) result.curves.push(curve);
			else result.skipped++;
		}
		return result;
	} finally {
		(file as unknown as Deletable).delete();
	}
}
