import type { RhinoModule } from 'rhino3dm';
import {
	decodeItem,
	encodeItem,
	isRhinoArchive,
	lineFromRhinoJson,
	lineToRhinoJson,
	pointFromRhinoJson,
	pointToRhinoJson
} from '@selvajs/sketch/io';
import {
	explodeToLines,
	groupByPath,
	isPoint,
	parsePath,
	type SketchItem
} from '@selvajs/sketch/model';

// What a drawn input's value looks like on its way to Rhino.Compute, per `paramType`:
// - `line` (Get Line): `{ From, To }` objects.
// - `point` (Get Point): `{ X, Y, Z }` objects.
// - `geometry` (Get Geometry): Rhino archive objects, which only rhino3dm can write.
//
// Items all in branch {0} go as a list. Any other path turns the value into a branch map,
// `{ '{0;1}': [...] }`, which the solve sends as a Grasshopper data tree. Each item is one JSON
// string on the wire.

export type SketchParamType = 'line' | 'point' | 'geometry';

interface Branch {
	/** Undefined for the default branch, {0}. */
	path: number[] | undefined;
	items: unknown[];
}

const flatItems = (value: unknown): unknown[] => {
	if (value === null || value === undefined || value === '') return [];
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text.startsWith('{') && !text.startsWith('[')) return [];
		try {
			return flatItems(JSON.parse(text));
		} catch {
			return [];
		}
	}
	if (Array.isArray(value)) return value.flatMap(flatItems);
	return typeof value === 'object' ? [value] : [];
};

const isDefaultPath = (path: readonly number[] | null | undefined) =>
	!path || (path.length === 1 && path[0] === 0);

/**
 * The branches of a value, whatever wraps it: a definition default arrives as one item, a list, a
 * branch map or any of those as JSON text.
 */
export function valueBranches(value: unknown): Branch[] {
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text.startsWith('{') && !text.startsWith('[')) return [];
		try {
			return valueBranches(JSON.parse(text));
		} catch {
			return [];
		}
	}
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const entries = Object.entries(value).map(([key, items]) => [parsePath(key), items] as const);
		if (entries.length > 0 && entries.every(([path]) => path !== null)) {
			return entries.map(([path, items]) => ({
				path: isDefaultPath(path) ? undefined : (path as number[]),
				items: flatItems(items)
			}));
		}
	}
	const items = flatItems(value);
	return items.length > 0 ? [{ path: undefined, items }] : [];
}

/** Whether reading the value needs rhino3dm, so the caller can load it first. */
export function valueNeedsRhino(value: unknown): boolean {
	return valueBranches(value).some((branch) => branch.items.some(isRhinoArchive));
}

/**
 * The curves and points a value holds, each with its branch as `path`. Anything else is left
 * out, as are archives when `rhino` is null.
 */
export function itemsFromValue(value: unknown, rhino: RhinoModule | null): SketchItem[] {
	const found: SketchItem[] = [];
	for (const { path, items } of valueBranches(value)) {
		for (const raw of items) {
			const item = isRhinoArchive(raw)
				? rhino && decodeItem(rhino, raw)
				: (lineFromRhinoJson(raw) ?? pointFromRhinoJson(raw));
			if (item) found.push(path ? { ...item, path } : item);
		}
	}
	return found;
}

/**
 * The value to solve with, or null for nothing to send: the input then falls back to the
 * definition's own value. A line input gets every curve as straight lines and a point input only
 * the points; what an input cannot take is left out. A geometry input needs `rhino`.
 */
export function valueFromItems(
	items: readonly SketchItem[],
	paramType: SketchParamType,
	rhino: RhinoModule | null
): unknown {
	let kept: readonly SketchItem[];
	let encode: (item: SketchItem) => unknown;
	if (paramType === 'line') {
		kept = explodeToLines(items);
		encode = (item) => lineToRhinoJson(item as (typeof kept)[number] & { kind: 'line' });
	} else if (paramType === 'point') {
		kept = items.filter(isPoint);
		encode = (item) => pointToRhinoJson(item as (typeof kept)[number] & { kind: 'point' });
	} else {
		if (!rhino) return null;
		kept = items;
		encode = (item) => encodeItem(rhino, item);
	}
	if (kept.length === 0) return null;
	if (kept.every((item) => isDefaultPath(item.path))) return kept.map(encode);
	return Object.fromEntries(
		[...groupByPath(kept)].map(([path, branch]) => [path, branch.map(encode)])
	);
}
