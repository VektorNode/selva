import { DataTreeDefault, DataTreePath, InputParam, DataTree } from '../types';
import { ComputeError, ErrorCodes, getLogger } from '@/core';
import { isDataTreeDefault, TREE_PATH_RE } from './tree-path';

/** Value types that can be stored in a DataTree. */
export type DataTreeValue = string | number | boolean | object | null;

/**
 * Data item for compute requests (not the `DataItem` interface used for responses).
 * TypeScript types `data` as string, but Rhino Compute accepts boolean/number primitives in JSON.
 */
interface ComputeDataItem {
	data: string | boolean | number;
}

/** InnerTree data structure for compute requests. */
type ComputeInnerTreeData = {
	[path in DataTreePath]: ComputeDataItem[];
};

/**
 * Standalone TreeBuilder class for constructing Grasshopper TreeBuilder structures.
 * Does not depend on RhinoCompute library.
 *
 * @example
 * ```ts
 * const tree = new TreeBuilder('MyParam')
 *   .append([0], [1, 2, 3])
 *   .append([1], [4, 5])
 *   .toComputeFormat();
 * ```
 */
export class TreeBuilder {
	private innerTree: ComputeInnerTreeData;
	private paramName: string;

	constructor(paramName: string) {
		this.paramName = paramName;
		this.innerTree = {} as ComputeInnerTreeData;
	}

	/**
	 * Append values to a specific branch path in the tree.
	 *
	 * @param path - Branch path as an integer array (e.g. [0], [0, 1])
	 * @param items - Values to append at this path
	 */
	public append(path: number[], items: DataTreeValue[]): this {
		const pathKey = TreeBuilder.formatPathString(path);

		if (!this.innerTree[pathKey]) {
			this.innerTree[pathKey] = [];
		}

		const dataItems: ComputeDataItem[] = items.map((item) => ({
			data: TreeBuilder.serializeValue(item)
		}));

		this.innerTree[pathKey].push(...dataItems);
		return this;
	}

	/** Append a single value to a branch path. */
	public appendSingle(path: number[], item: DataTreeValue): this {
		return this.append(path, [item]);
	}

	/** Set values from a DataTreeDefault structure (path keys like "{0;1}"), replacing any existing tree data. */
	public fromDataTreeDefault(treeData: DataTreeDefault): this {
		this.innerTree = {} as ComputeInnerTreeData;

		for (const [pathStr, items] of Object.entries(treeData)) {
			if (!Array.isArray(items)) continue;
			const path = TreeBuilder.parsePathString(pathStr);
			this.append(path, items);
		}

		return this;
	}

	/** Append flattened values to path [0], for simple flat (non-tree) inputs. */
	public appendFlat(values: DataTreeValue | DataTreeValue[]): this {
		const items = Array.isArray(values) ? values : [values];
		return this.append([0], items);
	}

	/** Get the flattened list of all values in the tree, across all branches. */
	public flatten(): DataTreeValue[] {
		const result: DataTreeValue[] = [];

		for (const items of Object.values(this.innerTree)) {
			if (Array.isArray(items)) {
				for (const item of items) {
					result.push(TreeBuilder.deserializeValue(item.data));
				}
			}
		}

		return result;
	}

	/** Get all branch paths in the tree. */
	public getPaths(): DataTreePath[] {
		return Object.keys(this.innerTree) as DataTreePath[];
	}

	/** Get values at a specific path, or undefined if the path doesn't exist. */
	public getPath(path: number[]): DataTreeValue[] | undefined {
		const pathKey = TreeBuilder.formatPathString(path);
		const items = this.innerTree[pathKey];
		if (!items) return undefined;
		return items.map((item: ComputeDataItem) => TreeBuilder.deserializeValue(item.data));
	}

	/** Convert to the format the Grasshopper Compute API expects. */
	public toComputeFormat(): DataTree {
		return {
			ParamName: this.paramName,
			InnerTree: this.innerTree as any // request format differs from the response type
		};
	}

	/** Get the raw InnerTree data structure. */
	public getInnerTree(): ComputeInnerTreeData {
		return this.innerTree;
	}

	public getParamName(): string {
		return this.paramName;
	}

	/**
	 * Create DataTrees from an array of InputParam definitions.
	 * Handles tree access, numeric constraints, and value parsing.
	 *
	 * @example
	 * ```ts
	 * const trees = TreeBuilder.fromInputParams(inputs);
	 * ```
	 */
	public static fromInputParams(inputs: InputParam[]): DataTree[] {
		return inputs
			.filter((input) => TreeBuilder.hasValidValue(input.default))
			.map((input) => {
				const tree = new TreeBuilder(input.nickname || 'unnamed');
				const value = input.default;

				// Handle tree access (complex TreeBuilder structure)
				if (input.treeAccess && isDataTreeDefault(value)) {
					tree.fromDataTreeDefault(value);

					// Apply numeric constraints to tree items
					if (TreeBuilder.isNumericInput(input)) {
						tree.applyNumericConstraints(input.minimum, input.maximum, input.nickname || 'unnamed');
					}
				}
				// Handle flat inputs
				else {
					const values = Array.isArray(value) ? value : [value];
					const processed = TreeBuilder.processValues(values, input);
					tree.appendFlat(processed);
				}

				return tree.toComputeFormat();
			});
	}

	/**
	 * Create a TreeBuilder from a single InputParam.
	 *
	 * @param input - Input parameter definition
	 * @returns InnerTree ready for compute or undefined if value is invalid
	 */
	public static fromInputParam(input: InputParam): DataTree | undefined {
		if (!TreeBuilder.hasValidValue(input.default)) return undefined;

		const trees = TreeBuilder.fromInputParams([input]);
		return trees[0];
	}

	/**
	 * Set or replace a parameter value, accepting either high-level `TreeBuilder[]`
	 * (build/modify before computation) or low-level `DataTree[]` (modify compute
	 * API results, typically from `client.solve()`). Returns the same kind of array
	 * it received.
	 *
	 * Copy-on-write: returns a new array, the caller's array is never mutated.
	 *
	 * @param newValue - The new value (scalar, array, or TreeBuilder structure)
	 *
	 * @example
	 * ```ts
	 * // With TreeBuilder instances (high-level)
	 * let trees = [new TreeBuilder('X'), new TreeBuilder('Y')];
	 * trees = TreeBuilder.replaceTreeValue(trees, 'X', 42);
	 * const result = await client.solve(definitionUrl,
	 *   trees.map(t => t.toComputeFormat())
	 * );
	 * ```
	 *
	 * @example
	 * ```ts
	 * // With InnerTree format (low-level, from API)
	 * let trees = await client.solve(definitionUrl, initialInputs);
	 * trees = TreeBuilder.replaceTreeValue(trees, 'X', 42);
	 * trees = TreeBuilder.replaceTreeValue(trees, 'Y', [1, 2, 3]);
	 * ```
	 */
	public static replaceTreeValue(
		trees: TreeBuilder[],
		paramName: string,
		newValue: DataTreeValue
	): TreeBuilder[];
	public static replaceTreeValue(
		trees: DataTree[],
		paramName: string,
		newValue: DataTreeValue
	): DataTree[];
	public static replaceTreeValue(
		trees: TreeBuilder[] | DataTree[],
		paramName: string,
		newValue: DataTreeValue
	): TreeBuilder[] | DataTree[] {
		const isBuilderArray = trees.length > 0 && trees[0] instanceof TreeBuilder;
		const builder = TreeBuilder.buildFromValue(paramName, newValue);

		if (isBuilderArray) {
			// Copy-on-write: never mutate the caller's array (e.g. pristine
			// defaults from fromInputParams must survive slider updates).
			const builders = (trees as TreeBuilder[]).slice();
			const idx = builders.findIndex((t) => t.getParamName() === paramName);
			if (idx !== -1) builders[idx] = builder;
			else builders.push(builder);
			return builders;
		}

		// Empty arrays land here too: see the "empty array" characterization
		// test in data-tree.test.ts: pins the current behavior of returning the
		// compute-format shape rather than a TreeBuilder.
		const dataTrees = (trees as DataTree[]).slice();
		const compiled = builder.toComputeFormat();
		const idx = dataTrees.findIndex((t) => t.ParamName === paramName);
		if (idx !== -1) dataTrees[idx] = compiled;
		else dataTrees.push(compiled);
		return dataTrees;
	}

	/**
	 * Build a TreeBuilder from a single value, dispatching on shape:
	 * DataTreeDefault structure, array, or scalar.
	 */
	private static buildFromValue(paramName: string, value: DataTreeValue): TreeBuilder {
		const tree = new TreeBuilder(paramName);
		if (isDataTreeDefault(value)) {
			tree.fromDataTreeDefault(value);
		} else {
			tree.appendFlat(value);
		}
		return tree;
	}

	/**
	 * Extract a value by parameter name from either a `TreeBuilder[]` or a
	 * compiled `DataTree[]` (typically from `client.solve()`).
	 *
	 * Return behavior: a single value unwraps (returns `5` not `[5]`), multiple
	 * values return as an array, and a missing parameter returns `null`.
	 *
	 * @example
	 * ```ts
	 * // With TreeBuilder instances
	 * const trees = [new TreeBuilder('X'), new TreeBuilder('Y')];
	 * trees[0].appendFlat(42);
	 * const x = TreeBuilder.getTreeValue(trees, 'X'); // Returns 42
	 * ```
	 *
	 * @example
	 * ```ts
	 * // With InnerTree from compute results
	 * const result = await client.solve(definitionUrl, inputs);
	 * const x = TreeBuilder.getTreeValue(result, 'X'); // Returns 42 (not [42])
	 * const points = TreeBuilder.getTreeValue(result, 'Points'); // Returns [point1, point2, ...]
	 * ```
	 */
	public static getTreeValue(trees: TreeBuilder[], paramName: string): DataTreeValue | null;
	public static getTreeValue(trees: DataTree[], paramName: string): DataTreeValue | null;
	public static getTreeValue(
		trees: TreeBuilder[] | DataTree[],
		paramName: string
	): DataTreeValue | null {
		const isBuilderArray = trees.length > 0 && trees[0] instanceof TreeBuilder;

		const values = isBuilderArray
			? TreeBuilder.readFromBuilders(trees as TreeBuilder[], paramName)
			: TreeBuilder.readFromDataTrees(trees as DataTree[], paramName);

		if (values === null) return null;
		if (values.length === 0) return null;
		if (values.length === 1) return values[0];
		return values;
	}

	/**
	 * Read all values for `paramName` across every branch of the matching builder.
	 * Returns null when the builder isn't found.
	 */
	private static readFromBuilders(
		builders: TreeBuilder[],
		paramName: string
	): DataTreeValue[] | null {
		const tree = builders.find((t) => t.getParamName() === paramName);
		return tree ? tree.flatten() : null;
	}

	/**
	 * Read values from the first branch of the matching compiled InnerTree.
	 * Multi-branch responses are not flattened (current semantics, pinned by
	 * the "reads from the first branch path only" test).
	 */
	private static readFromDataTrees(
		dataTrees: DataTree[],
		paramName: string
	): DataTreeValue[] | null {
		const tree = dataTrees.find((t) => t.ParamName === paramName);
		if (!tree?.InnerTree) return null;

		const firstKey = Object.keys(tree.InnerTree)[0];
		if (!firstKey) return null;

		// @ts-expect-error - Dynamic key access on innerTree
		const items = tree.InnerTree[firstKey];

		if (Array.isArray(items)) {
			// Preserve nulls (legitimate GH items) so indices don't shift; an
			// item without `data` deserializes to null in place. "Param not
			// found" is signalled only by a missing/empty tree, never by nulls.
			return items.map((item) =>
				item?.data !== undefined ? TreeBuilder.deserializeValue(item.data) : null
			);
		}

		if (items?.data !== undefined) return [TreeBuilder.deserializeValue(items.data)];
		return items !== undefined ? [items as DataTreeValue] : null;
	}

	/**
	 * Parse a branch path string like "{0;1;2}" into [0, 1, 2].
	 * Negative indices ("{-1;2}") and the root path "{}" are valid.
	 *
	 * @throws {ComputeError} `INVALID_INPUT` when the path string is not a valid
	 *   Grasshopper branch path. Malformed keys must never silently collapse to a
	 *   default branch: two distinct unparseable keys would merge their items
	 *   into one branch.
	 */
	public static parsePathString(pathStr: string): number[] {
		const match = pathStr.match(TREE_PATH_RE);
		if (!match) {
			throw new ComputeError(
				`Invalid Grasshopper tree path: "${pathStr}". ` +
					`Expected "{}", "{0}", or "{0;1;2}" (negative indices allowed, no empty segments).`,
				ErrorCodes.INVALID_INPUT,
				{ context: { pathStr } }
			);
		}
		// Root path "{}": the (optional) capture group is undefined/empty.
		if (!match[1]) return [];
		return match[1].split(';').map(Number);
	}

	/** Format a path array into branch path string format, e.g. [0, 1, 2] -> "{0;1;2}". */
	public static formatPathString(path: number[]): DataTreePath {
		return `{${path.join(';')}}` as DataTreePath;
	}

	/** Apply numeric constraints to all tree values. */
	private applyNumericConstraints(
		min: number | null | undefined,
		max: number | null | undefined,
		inputName: string
	): void {
		for (const items of Object.values(this.innerTree)) {
			if (!Array.isArray(items)) continue;

			for (const item of items) {
				const value = TreeBuilder.deserializeValue(item.data);
				if (typeof value === 'number') {
					const clamped = TreeBuilder.clampValue(value, min, max, inputName);
					item.data = TreeBuilder.serializeValue(clamped);
				}
			}
		}
	}

	/** Serialize a value for compute requests, preserving booleans and numbers as primitives. */
	private static serializeValue(value: DataTreeValue): string | boolean | number {
		if (typeof value === 'boolean') return value;
		if (typeof value === 'number') return value;
		if (typeof value === 'string') return value;
		if (typeof value === 'object' && value !== null) {
			return JSON.stringify(value);
		}
		return String(value);
	}

	/** Deserialize a value back to its original type, handling both string-encoded and primitive values. */
	private static deserializeValue(data: string | boolean | number): DataTreeValue {
		if (typeof data === 'boolean') return data;
		if (typeof data === 'number') return data;
		if (typeof data !== 'string') return data;

		if (data.startsWith('{') || data.startsWith('[')) {
			try {
				return JSON.parse(data);
			} catch {
				return data;
			}
		}
		// Coerce to number only when the string is the *canonical* form of a
		// finite number, i.e. it round-trips exactly (String(Number(s)) === s).
		// API responses encode numbers as strings ('42', '3.14', '1e+21'), and
		// those must come back numeric, but non-canonical numeric-looking
		// strings ('007', '1e5', 'Infinity', '', '  5') were strings on the
		// wire and must stay strings.
		const num = Number(data);
		if (Number.isFinite(num) && String(num) === data) {
			return num;
		}
		if (data === 'true') return true;
		if (data === 'false') return false;
		return data;
	}

	private static hasValidValue(value: unknown): boolean {
		if (value === undefined || value === null) return false;
		if (typeof value === 'string') return true;
		if (Array.isArray(value) && value.length === 0) return false;
		if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
			return false;
		return true;
	}

	private static isNumericInput(input: InputParam): input is InputParam & {
		paramType: 'Number' | 'Integer';
		minimum?: number | null;
		maximum?: number | null;
	} {
		return input.paramType === 'Number' || input.paramType === 'Integer';
	}

	private static processValues(values: DataTreeValue[], input: InputParam): DataTreeValue[] {
		return values
			.map((val) => {
				if (TreeBuilder.isNumericInput(input) && typeof val === 'number') {
					return TreeBuilder.clampValue(
						val,
						input.minimum,
						input.maximum,
						input.nickname || 'unnamed'
					);
				}
				// Serialization (objects to JSON strings) happens in append, not here.
				return val;
			})
			.filter((v) => v !== null && v !== undefined);
	}

	private static clampValue(
		value: number,
		min: number | null | undefined,
		max: number | null | undefined,
		inputName: string
	): number {
		let result = value;

		if (min !== null && min !== undefined && result < min) {
			getLogger().warn(`${inputName}: ${value} below min ${min}, clamping`);
			result = min;
		}
		if (max !== null && max !== undefined && result > max) {
			getLogger().warn(`${inputName}: ${value} above max ${max}, clamping`);
			result = max;
		}

		return result;
	}
}
