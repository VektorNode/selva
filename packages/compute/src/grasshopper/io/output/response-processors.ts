import { FileData } from '@/core/files/types';
import { readField } from '@/core/utils/read-field';
import { GrasshopperComputeResponse, DataItem } from '../../types';
import { decodeRhinoGeometry, disposeRhinoObjects } from './rhino-decoder';

export interface ParsedContext {
	[key: string]: any;
}

export interface GetValuesOptions {
	parseValues?: boolean;
	rhino?: any;
	/** Keep only values of type System.String; other types are filtered out. */
	stringOnly?: boolean;
}

export interface GetValuesResult<T = ParsedContext> {
	values: T;
	/**
	 * Free every rhino3dm WASM object decoded into `values`. When a `rhino`
	 * instance was passed, decoded geometry lives on the WASM heap and is never
	 * garbage-collected: call this once the values are consumed, or the heap
	 * grows monotonically across solves. Idempotent; a no-op when nothing was
	 * decoded. `values` must not be used after disposal.
	 */
	dispose: () => void;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const SYSTEM_TYPES = {
	STRING: 'System.String',
	INT: 'System.Int32',
	DOUBLE: 'System.Double',
	BOOL: 'System.Boolean'
};

const RHINO_GEOMETRY_PREFIX = 'Rhino.Geometry.';

const EXCLUDED_TYPES = ['WebDisplay'];
const FILE_DATA_TYPE = 'FileData';

function isExcludedType(type: string): boolean {
	return EXCLUDED_TYPES.some((t) => type.includes(t));
}

function tryDecodeJSON(value: string): any {
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

function decodeBySystemType(raw: any, type: string, rhino?: any): any {
	switch (type) {
		case SYSTEM_TYPES.STRING:
			if (typeof raw !== 'string') return raw;
			return raw.replace(/^"(.*)"$/, '$1');

		case SYSTEM_TYPES.INT:
			return Number.parseInt(raw, 10);

		case SYSTEM_TYPES.DOUBLE:
			return Number.parseFloat(raw);

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
 * Per-item memo of the (potentially double) JSON.parse in {@link tryDecodeJSON}
 * (issue 84). Response items are immutable wire data, so the parse result is
 * stable; repeated `getValues()`/`getValue()` calls over the same response (a
 * common pattern: read one param, then another) would otherwise re-run up to
 * two full `JSON.parse` passes per item over potentially multi-MB strings.
 *
 * Keyed weakly on the item object, so the cache lives exactly as long as the
 * response it belongs to. Consequence: parsed JSON objects are shared across
 * reads of the same response, callers must treat them as read-only. Rhino
 * geometry is not shared: `decodeRhinoGeometry` constructs a fresh WASM object
 * per call, so `dispose()` on one read never invalidates another.
 */
const decodedJsonCache = new WeakMap<DataItem, unknown>();

function decodeItemJSON(item: DataItem): unknown {
	if (decodedJsonCache.has(item)) return decodedJsonCache.get(item);
	const parsed = tryDecodeJSON(item.data);
	decodedJsonCache.set(item, parsed);
	return parsed;
}

// Assumes type has already been filtered through isExcludedType at the call
// site: returning a sentinel from here would pollute the aggregated arrays in
// getValues / getValue when multiple branches are mixed.
function extractItemValue(item: DataItem, type: string, parseValues: boolean, rhino?: any): any {
	if (typeof item.data !== 'string') return item.data;

	const raw = parseValues ? decodeItemJSON(item) : item.data;
	return decodeBySystemType(raw, type, rhino);
}

/** Type guard for {@link FileData}: the Compute server emits these as JSON blobs inside `FileData`-typed values. */
function isFileData(value: unknown): value is FileData {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.fileName === 'string' &&
		typeof v.fileType === 'string' &&
		'data' in v &&
		typeof v.isBase64Encoded === 'boolean' &&
		typeof v.subFolder === 'string'
	);
}

// Traversal helpers

/**
 * The response's params array, read case-insensitively (`values` vs `Values`
 * across server branches) with a null guard. Partial-success and warnings-only
 * responses can arrive with `values` missing entirely: treat that as "no
 * params" instead of crashing (issue 62), mirroring the defense in solve.ts.
 */
function getResponseParams(response: GrasshopperComputeResponse): unknown[] {
	const values = readField<unknown[]>(response, 'values');
	return Array.isArray(values) ? values : [];
}

function itemType(item: DataItem): string {
	return typeof item.type === 'string' ? item.type : '';
}

/**
 * Tolerates a missing/null tree (params in warnings-only partial successes and
 * the e2e fixtures ship without `InnerTree`, issue 62) and skips non-object
 * items so handlers never see `null`.
 */
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

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Read all output values from a Grasshopper Compute response, keyed by parameter
 * name (or ID when `byId`). Duplicate keys aggregate into an array.
 *
 * `ParamName`/`InnerTree` are read case-insensitively (server branches differ in
 * casing) and params without an `InnerTree` are skipped rather than crashing.
 *
 * Parsed (non-geometry) JSON values are memoized per response item: repeated
 * reads of the same response return the same object identity, so treat parsed
 * values as read-only. Geometry decoded via `rhino` is always freshly
 * constructed; free it with `dispose()`.
 */
export function getValues<T = ParsedContext>(
	response: GrasshopperComputeResponse,
	byId: boolean = false,
	options: GetValuesOptions = {}
): GetValuesResult<T> {
	const { parseValues = true, rhino, stringOnly = false } = options;
	const result: ParsedContext = {};
	// Keys holding an aggregation array (vs. a single value that happens to be an array,
	// e.g. parsed JSON `[1,2,3]`): `Array.isArray(result[key])` can't tell those apart.
	const aggregated = new Set<string>();

	for (const param of getResponseParams(response)) {
		const paramName = readField<string>(param, 'paramName');
		forEachTreeItem(readField(param, 'innerTree'), (item) => {
			const type = itemType(item);
			// Skip excluded types (e.g. WebDisplay): leaving them in
			// would write null into the aggregated result.
			if (isExcludedType(type)) return;
			if (stringOnly && type !== SYSTEM_TYPES.STRING) return;

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

			const parsed = decodeItemJSON(item);
			if (isFileData(parsed)) {
				output.push(parsed);
			}
		});
	}

	return output;
}

/**
 * Read one parameter's value(s) from a response: `byName` matches a `ParamName`,
 * `byId` matches an item ID. Returns `undefined` if absent, a single value for one
 * match, or an array for several.
 *
 * `ParamName`/`InnerTree` are read case-insensitively with null guards, and the
 * scan is a single pass that stops at the first matching parameter (issue 84,
 * previously `byId` walked every tree twice). Parsed non-geometry JSON values
 * are memoized per response item; treat them as read-only.
 *
 * When a `rhino` instance is passed, decoded geometry lives on the WASM heap:
 * free it with {@link disposeRhinoObjects} once consumed.
 */
export function getValue(
	response: GrasshopperComputeResponse,
	options: { byName: string } | { byId: string },
	parseOptions: GetValuesOptions = {}
): any {
	const { parseValues = true, rhino, stringOnly = false } = parseOptions;

	// Single pass with early exit: the first param that matches (by name, or by
	// containing an item with the target id) is the target: collect from it and
	// return without scanning the remaining trees.
	for (const param of getResponseParams(response)) {
		const tree = readField(param, 'innerTree');

		let matched = false;
		if ('byName' in options) {
			if (readField<string>(param, 'paramName') !== options.byName) continue;
			matched = true;
		}

		const collected: any[] = [];
		forEachTreeItem(tree, (item) => {
			if ('byId' in options) {
				if (item.id !== options.byId) return;
				// The param owning this id is the target even if every matching
				// item is filtered out below (preserves the previous two-pass
				// semantics: found-but-filtered → undefined, not keep-scanning).
				matched = true;
			}
			const type = itemType(item);
			if (isExcludedType(type)) return;
			if (stringOnly && type !== SYSTEM_TYPES.STRING) return;
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
