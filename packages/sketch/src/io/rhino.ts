import type { Curve, GeometryBase, NurbsCurve, RhinoModule } from 'rhino3dm';
import {
	isValidCurve,
	isValidItem,
	type Point3,
	type SketchCurve,
	type SketchItem,
	type SketchLine,
	type SketchNurbs,
	type SketchPoint
} from '../model/curve.js';

// ============================================================================
// Curves and points to and from Rhino
// ============================================================================
//
// Rhino.Compute reads a Get Geometry value as Rhino's own archive JSON, the output of
// `CommonObject.encode()`: `{ version, archive3dm, opennurbs, data: "<base64>" }`. Only rhino3dm
// can write it, so those functions take the loaded module. A Get Line or Get Point value is plain
// JSON and needs none.
//
// An archive carries the object's user strings, which is how an item's `attributes` reach Rhino.
// The plain JSON shapes are bare structs and carry none.
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

/** A Get Point value, as Rhino.Compute deserializes `Rhino.Geometry.Point3d`. */
export interface RhinoPointJson {
	X: number;
	Y: number;
	Z: number;
}

/** A Get Line value, as Rhino.Compute deserializes `Rhino.Geometry.Line`. */
export interface RhinoLineJson {
	From: RhinoPointJson;
	To: RhinoPointJson;
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

// ============================================================================
// To Rhino
// ============================================================================

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

/**
 * The archive of a curve or a point, with its attributes as user strings.
 *
 * @throws {Error} When the item is one Rhino would reject, such as a zero-length line.
 */
export function encodeItem(rhino: RhinoModule, item: SketchItem): RhinoArchive {
	if (!isValidItem(item)) throw new Error(`Cannot encode an invalid ${item.kind}.`);
	const geometry: GeometryBase =
		item.kind === 'point' ? new rhino.Point(array(item.at)) : toRhinoCurve(rhino, item);
	try {
		for (const [key, value] of Object.entries(item.attributes ?? {})) {
			geometry.setUserString(key, value);
		}
		// rhino3dm types `encode()` as void.
		return geometry.encode() as unknown as RhinoArchive;
	} finally {
		(geometry as unknown as Deletable).delete();
	}
}

const xyz = ([X, Y, Z]: Point3): RhinoPointJson => ({ X, Y, Z });

export function pointToRhinoJson(point: SketchPoint): RhinoPointJson {
	return xyz(point.at);
}

export function lineToRhinoJson(line: SketchLine): RhinoLineJson {
	return { From: xyz(line.from), To: xyz(line.to) };
}

// ============================================================================
// From Rhino
// ============================================================================

const samePoint = (a: Point3, b: Point3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

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

/** A Rhino curve or point as an item with its user strings; null for any other geometry. */
function fromRhinoGeometry(rhino: RhinoModule, geometry: unknown): SketchItem | null {
	let item: SketchItem | null = null;
	if (geometry instanceof rhino.Point) item = { kind: 'point', at: point3(geometry.location) };
	else if (geometry instanceof rhino.Curve) item = fromRhinoCurve(rhino, geometry);
	if (!item || !isValidItem(item)) return null;

	// rhino3dm types the list as string[]; it is [key, value] pairs.
	const pairs = (geometry as GeometryBase).getUserStrings() as unknown as [string, string][];
	return pairs.length > 0 ? { ...item, attributes: Object.fromEntries(pairs) } : item;
}

/** Null when the archive holds something other than a curve or a point, or cannot be read. */
export function decodeItem(rhino: RhinoModule, archive: RhinoArchive): SketchItem | null {
	let decoded: unknown;
	try {
		decoded = rhino.CommonObject.decode(archive);
	} catch {
		return null;
	}
	if (!decoded) return null;
	try {
		return fromRhinoGeometry(rhino, decoded);
	} finally {
		(decoded as Deletable).delete?.();
	}
}

const readXyz = (value: unknown): Point3 | null => {
	const { X, Y, Z } = (value ?? {}) as Record<string, unknown>;
	return [X, Y, Z].every((n) => typeof n === 'number' && Number.isFinite(n))
		? [X as number, Y as number, Z as number]
		: null;
};

/** Null for anything that is not an `{ X, Y, Z }` point with finite coordinates. */
export function pointFromRhinoJson(value: unknown): SketchPoint | null {
	const at = readXyz(value);
	return at ? { kind: 'point', at } : null;
}

/** Null for anything that is not a `{ From, To }` line with finite coordinates. */
export function lineFromRhinoJson(value: unknown): SketchLine | null {
	const { From, To } = (value ?? {}) as Record<string, unknown>;
	const from = readXyz(From);
	const to = readXyz(To);
	const line: SketchLine | null = from && to ? { kind: 'line', from, to } : null;
	return line && isValidCurve(line) ? line : null;
}

// ============================================================================
// 3DM files
// ============================================================================

export interface File3dmImport {
	/** Curves and points, in the file's own units. */
	items: SketchItem[];
	/** Null when the file's unit system has no fixed length, such as custom units. */
	metersPerUnit: number | null;
	/** Objects that are neither: surfaces, meshes, blocks. */
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
 * Reads the curves and points out of a `.3dm` file. Block instances are not expanded.
 *
 * @throws {Error} When the bytes are not a readable `.3dm`.
 */
export function read3dm(rhino: RhinoModule, bytes: Uint8Array): File3dmImport {
	const file = rhino.File3dm.fromByteArray(bytes);
	if (!file) throw new Error('Not a readable .3dm file.');
	try {
		const result: File3dmImport = {
			items: [],
			metersPerUnit: metersPerFileUnit(rhino, file.settings().modelUnitSystem),
			skipped: 0
		};
		const objects = file.objects();
		for (let i = 0; i < objects.count; i++) {
			const item = fromRhinoGeometry(rhino, objects.get(i).geometry());
			if (item) result.items.push(item);
			else result.skipped++;
		}
		return result;
	} finally {
		(file as unknown as Deletable).delete();
	}
}
