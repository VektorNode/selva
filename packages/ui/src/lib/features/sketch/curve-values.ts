import type { RhinoModule } from 'rhino3dm';
import {
	decodeCurve,
	encodeCurve,
	isRhinoArchive,
	lineFromRhinoJson,
	lineToRhinoJson
} from '@selvajs/sketch/io';
import { explodeToLines, type SketchCurve } from '@selvajs/sketch/model';

// What a curve input's value looks like on its way to Rhino.Compute, per `paramType`:
// - `line` (Get Line): a list of `{ From, To }` objects.
// - `geometry` (Get Geometry): a list of Rhino archive objects, which only rhino3dm can write.
// The solve sends each list item as one JSON string in branch {0}.

const TREE_PATH = /^\{[\d;-]*\}$/;

/**
 * The items of a value, whatever wraps them: a definition default arrives as one item, a list, a
 * branch map (`{ '{0}': [...] }`) or any of those as JSON text.
 */
export function valueItems(value: unknown): unknown[] {
	if (value === null || value === undefined || value === '') return [];
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text.startsWith('{') && !text.startsWith('[')) return [];
		try {
			return valueItems(JSON.parse(text));
		} catch {
			return [];
		}
	}
	if (Array.isArray(value)) return value.flatMap(valueItems);
	if (typeof value !== 'object') return [];
	const keys = Object.keys(value);
	if (keys.length > 0 && keys.every((key) => TREE_PATH.test(key))) {
		return Object.values(value).flatMap(valueItems);
	}
	return [value];
}

/** Whether reading the value needs rhino3dm, so the caller can load it first. */
export function valueNeedsRhino(value: unknown): boolean {
	return valueItems(value).some(isRhinoArchive);
}

/**
 * The curves a value holds. Items that are not curves are left out, as are archives when `rhino`
 * is null; a `{ From, To }` line is read either way.
 */
export function curvesFromValue(value: unknown, rhino: RhinoModule | null): SketchCurve[] {
	const curves: SketchCurve[] = [];
	for (const item of valueItems(value)) {
		const curve = isRhinoArchive(item)
			? rhino && decodeCurve(rhino, item)
			: lineFromRhinoJson(item);
		if (curve) curves.push(curve);
	}
	return curves;
}

/**
 * The value to solve with, or null for no curves: the input then falls back to the definition's
 * own value. A line input gets every curve as straight lines, with curved NURBS left out.
 */
export function valueFromCurves(
	curves: readonly SketchCurve[],
	paramType: 'line' | 'geometry',
	rhino: RhinoModule | null
): unknown[] | null {
	if (paramType === 'line') {
		const lines = explodeToLines(curves).map(lineToRhinoJson);
		return lines.length > 0 ? lines : null;
	}
	if (!rhino || curves.length === 0) return null;
	return curves.map((curve) => encodeCurve(rhino, curve));
}
