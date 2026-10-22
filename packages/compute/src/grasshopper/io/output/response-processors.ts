import { isBase64Flag } from '@/core/files/handle-files';
import type { RhinoModule } from 'rhino3dm';
import { FileData } from '@/core/files/types';
import { hasField, readField } from '@/core/utils/read-field';
import { GrasshopperComputeResponse, DataItem } from '../../types';
import { decodeRhinoGeometry, disposeRhinoObjects } from './rhino-decoder';

export interface ParsedContext {
	[key: string]: any;
}

export interface GetValuesOptions {
	parseValues?: boolean;
	rhino?: any;
	/**
	 * If true, only include values of type System.String in the result.
	 * Non-string types are filtered out.
	 */
	stringOnly?: boolean;
}

export interface GetValuesResult<T = ParsedContext> {
	values: T;
	/**
	 * Free every rhino3dm WASM object decoded into `values`. When a `rhino`
	 * instance was passed, decoded geometry lives on the WASM heap and is never
	 * garbage-collected — call this once the values are consumed, or the heap
	 * grows monotonically across solves. Idempotent; a no-op when nothing was
	 * decoded. `values` must not be used after disposal.
	 */
	dispose: () => void;
}

const SYSTEM_TYPES = {
	STRING: 'System.String',
	INT: 'System.Int32',
	DOUBLE: 'System.Double',
	BOOL: 'System.Boolean'
};

const RHINO_GEOMETRY_PREFIX = 'Rhino.Geometry.';

const FILE_DATA_TYPE = 'FileData';

/** WebDisplay items are skipped entirely: kept, they would write `null` into the result. */
function skipItem(type: string, stringOnly: boolean): boolean {
	return type.includes('WebDisplay') || (stringOnly && type !== SYSTEM_TYPES.STRING);
}

function tryDecodeJSON(value: string): unknown {
	if (typeof value !== 'string') return value;

	const trimmed = value.trim();
	const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"');
	if (!looksJson) return value;

	try {
		const first = JSON.parse(trimmed);
		if (typeof first === 'string') {
			try {
				return JSON.parse(first);
			} catch {
				return first;
			}
		}
		return first;
	} catch {
		return value;
	}
}

function decodeBySystemType(raw: unknown, type: string, rhino?: RhinoModule): unknown {
	switch (type) {
		case SYSTEM_TYPES.STRING:
			if (typeof raw !== 'string') return raw;
			return raw.replace(/^"(.*)"$/, '$1');

		case SYSTEM_TYPES.INT:
			return Number.parseInt(String(raw), 10);

		case SYSTEM_TYPES.DOUBLE:
			return Number.parseFloat(String(raw));

		case SYSTEM_TYPES.BOOL: {
			const str = String(raw).toLowerCase();
			return str === 'true';
		}

		default:
			if (rhino && type.startsWith(RHINO_GEOMETRY_PREFIX)) {
				return decodeRhinoGeometry(raw, type, rhino);
			}
			return raw;
	}
}

/**
 * Per-item memo of {@link tryDecodeJSON}, which can run two `JSON.parse` passes
 * over a multi-MB string. Parsed objects are therefore shared across reads of one
 * response; rhino geometry is not (`decodeRhinoGeometry` builds a fresh object).
 */
const decodedJsonCache = new WeakMap<DataItem, unknown>();

function decodeItemJSON(item: DataItem): unknown {
	if (decodedJsonCache.has(item)) return decodedJsonCache.get(item);
	const parsed = tryDecodeJSON(item.data);
	decodedJsonCache.set(item, parsed);
	return parsed;
}

function extractItemValue(
	item: DataItem,
	type: string,
	parseValues: boolean,
	rhino?: RhinoModule
): unknown {
	if (typeof item.data !== 'string') return item.data;

	const raw = parseValues ? decodeItemJSON(item) : item.data;
	if (parseValues && type.includes(FILE_DATA_TYPE)) {
		return asFileData(raw) ?? raw;
	}

	return decodeBySystemType(raw, type, rhino);
}

/**
 * A parsed `FileData` blob in the camelCase shape {@link FileData} documents, or
 * `null` when a required field is missing. Fields are read with `readField`,
 * since their casing varies by server branch.
 */
function asFileData(value: unknown): FileData | null {
	if (!value || typeof value !== 'object') return null;

	const fileName = readField<unknown>(value, 'fileName');
	const fileType = readField<unknown>(value, 'fileType');
	const subFolder = readField<unknown>(value, 'subFolder');
	const flag = readField<unknown>(value, 'isBase64Encoded');

	if (typeof fileName !== 'string' || typeof fileType !== 'string') return null;
	if (typeof subFolder !== 'string') return null;
	// Presence, not type: `data` may legitimately be '' and is validated downstream.
	if (!hasField(value, 'data')) return null;
	// Reject a flag that is neither a boolean nor a boolean-ish string, rather
	// than coercing arbitrary values to `false` and mis-decoding the payload.
	if (typeof flag !== 'boolean' && typeof flag !== 'string') return null;

	const metadata = readField<Record<string, string>>(value, 'metadata');

	return {
		fileName,
		fileType,
		data: readField<string>(value, 'data') as string,
		isBase64Encoded: isBase64Flag(flag),
		subFolder,
		...(metadata ? { metadata } : {})
	};
}

/** Partial-success and warnings-only responses can arrive with no `values` at all. */
function getResponseParams(response: GrasshopperComputeResponse): unknown[] {
	const values = readField<unknown[]>(response, 'values');
	return Array.isArray(values) ? values : [];
}

/** A param's item type, tolerating items whose `type` is missing/non-string. */
function itemType(item: DataItem): string {
	return typeof item.type === 'string' ? item.type : '';
}

/** Tolerates a missing tree (warnings-only partial successes) and skips non-object items. */
function forEachTreeItem(tree: unknown, handler: (item: DataItem) => void) {
	if (!tree || typeof tree !== 'object') return;
	for (const list of Object.values(tree)) {
		if (Array.isArray(list)) {
			for (const item of list) {
				if (item && typeof item === 'object') handler(item as DataItem);
			}
		}
	}
}

/**
 * Read all output values from a Grasshopper Compute response, keyed by parameter
 * name (or ID when `byId`). Duplicate keys aggregate into an array.
 *
 * Parsed (non-geometry) JSON values are memoized per response item: repeated
 * reads of the same response return the same object, so treat them as
 * read-only. Geometry decoded via `rhino` is always fresh; free it with `dispose()`.
 *
 * @param options.parseValues - Parse complex data types into JS objects (default true).
 * @param options.rhino - Rhino3dm instance for geometry decoding.
 * @param options.stringOnly - Keep only string-typed items.
 */
export function getValues<T = ParsedContext>(
	response: GrasshopperComputeResponse,
	byId: boolean = false,
	options: GetValuesOptions = {}
): GetValuesResult<T> {
	const { parseValues = true, rhino, stringOnly = false } = options;
	const result: ParsedContext = {};
	// Keys holding an aggregation array (vs. a single value that happens to BE an array,
	// e.g. parsed JSON `[1,2,3]`) — `Array.isArray(result[key])` can't tell those apart.
	const aggregated = new Set<string>();

	for (const param of getResponseParams(response)) {
		const paramName = readField<string>(param, 'paramName');
		forEachTreeItem(readField(param, 'innerTree'), (item) => {
			const type = itemType(item);
			if (skipItem(type, stringOnly)) return;

			const key = byId ? item.id : paramName;
			if (!key) return;

			const value = extractItemValue(item, type, parseValues, rhino);

			if (!(key in result)) {
				result[key] = value;
			} else if (aggregated.has(key)) {
				result[key].push(value);
			} else {
				result[key] = [result[key], value];
				aggregated.add(key);
			}
		});
	}

	return { values: result as T, dispose: () => disposeRhinoObjects(result) };
}

/** Decode every file-data item in a response into {@link FileData} objects. */
export function extractFileData(response: GrasshopperComputeResponse): FileData[] {
	const output: FileData[] = [];

	for (const param of getResponseParams(response)) {
		forEachTreeItem(readField(param, 'innerTree'), (item) => {
			if (!itemType(item).includes(FILE_DATA_TYPE)) return;

			const file = asFileData(decodeItemJSON(item));
			if (file) {
				output.push(file);
			}
		});
	}

	return output;
}

/**
 * Read one parameter's value(s) from a response — `byName` matches a `ParamName`,
 * `byId` matches an item ID. Returns `undefined` if absent, a single value for one
 * match, or an array for several.
 *
 * Parsed non-geometry JSON values are memoized per response item; treat them as
 * read-only. Geometry decoded via `rhino` lives on the WASM heap: free it with
 * `disposeRhinoObjects` once consumed.
 *
 * @param parseOptions.parseValues - Parse raw data into formatted values (default true).
 * @param parseOptions.rhino - Rhino3dm instance for geometry decoding.
 * @param parseOptions.stringOnly - Keep only string-typed items.
 */
export function getValue(
	response: GrasshopperComputeResponse,
	options: { byName: string } | { byId: string },
	parseOptions: GetValuesOptions = {}
): any {
	const { parseValues = true, rhino, stringOnly = false } = parseOptions;

	// The first param that matches, by name or by holding the target id, is the target.
	for (const param of getResponseParams(response)) {
		const tree = readField(param, 'innerTree');

		let matched = false;
		if ('byName' in options) {
			if (readField<string>(param, 'paramName') !== options.byName) continue;
			matched = true;
		}

		const collected: unknown[] = [];
		forEachTreeItem(tree, (item) => {
			if ('byId' in options) {
				if (item.id !== options.byId) return;
				// Found but filtered out below still ends the scan, returning undefined.
				matched = true;
			}
			const type = itemType(item);
			if (skipItem(type, stringOnly)) return;
			collected.push(extractItemValue(item, type, parseValues, rhino));
		});

		if (matched) {
			if (collected.length === 0) return undefined;
			if (collected.length === 1) return collected[0];
			return collected;
		}
	}

	return undefined;
}
