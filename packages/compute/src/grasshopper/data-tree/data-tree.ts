import { DataTreeDefault, DataTreePath, InputParam, DataTree, InnerTreeData } from '../types';
import { ComputeError, ErrorCodes, getLogger } from '@/core';
import { isDataTreeDefault, TREE_PATH_RE } from './tree-path';

export type DataTreeValue = string | number | boolean | object | null;

/** A request item. Unlike a response `DataItem`, Rhino Compute takes boolean/number primitives here. */
interface ComputeDataItem {
	data: string | boolean | number;
}

type ComputeInnerTreeData = {
	[path in DataTreePath]: ComputeDataItem[];
};

/**
 * Builds the Grasshopper data trees a solve takes as input.
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

	/** Append values to the branch at `path` (`[0, 1]` is `{0;1}`). */
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

	public appendSingle(path: number[], item: DataTreeValue): this {
		return this.append(path, [item]);
	}

	/** Replace the tree with a branch-path map like `{ '{0;1}': [1, 2] }`. */
	public fromDataTreeDefault(treeData: DataTreeDefault): this {
		this.innerTree = {} as ComputeInnerTreeData;

		for (const [pathStr, items] of Object.entries(treeData)) {
			if (!Array.isArray(items)) continue;
			const path = TreeBuilder.parsePathString(pathStr);
			this.append(path, items);
		}

		return this;
	}

	/** Append a value, or each value of an array, to branch `{0}`. */
	public appendFlat(values: DataTreeValue | DataTreeValue[]): this {
		const items = Array.isArray(values) ? values : [values];
		return this.append([0], items);
	}

	/** Every value across all branches. */
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

	public getPaths(): DataTreePath[] {
		return Object.keys(this.innerTree) as DataTreePath[];
	}

	/** The values at `path`, or `undefined` when the branch doesn't exist. */
	public getPath(path: number[]): DataTreeValue[] | undefined {
		const pathKey = TreeBuilder.formatPathString(path);
		const items = this.innerTree[pathKey];
		if (!items) return undefined;
		return items.map((item: ComputeDataItem) => TreeBuilder.deserializeValue(item.data));
	}

	/** The tree in the shape a solve request sends. */
	public toComputeFormat(): DataTree {
		return {
			ParamName: this.paramName,
			// `DataTree` types the response item shape; a request item is looser.
			InnerTree: this.innerTree as unknown as InnerTreeData
		};
	}

	public getInnerTree(): ComputeInnerTreeData {
		return this.innerTree;
	}

	public getParamName(): string {
		return this.paramName;
	}

	/**
	 * One tree per input that has a default, keyed by its nickname. Numeric values
	 * are clamped to the input's minimum/maximum.
	 */
	public static fromInputParams(inputs: InputParam[]): DataTree[] {
		return inputs
			.filter((input) => TreeBuilder.hasValidValue(input.default))
			.map((input) => {
				const name = input.nickname || 'unnamed';
				const tree = new TreeBuilder(name);
				const value = input.default;
				const isNumeric = input.paramType === 'Number' || input.paramType === 'Integer';

				// Dispatch on shape, not `treeAccess`: normalizeDefault also keeps list-access
				// (`atMost > 1`) defaults as trees, which would otherwise ship as one JSON string.
				if (isDataTreeDefault(value)) {
					tree.fromDataTreeDefault(value);
					if (isNumeric) tree.applyNumericConstraints(input.minimum, input.maximum, name);
				} else {
					const values = Array.isArray(value) ? value : [value];
					tree.appendFlat(
						values
							.map((val) =>
								isNumeric && typeof val === 'number'
									? TreeBuilder.clampValue(val, input.minimum, input.maximum, name)
									: val
							)
							.filter((v) => v !== null && v !== undefined)
					);
				}

				return tree.toComputeFormat();
			});
	}

	public static fromInputParam(input: InputParam): DataTree | undefined {
		if (!TreeBuilder.hasValidValue(input.default)) return undefined;

		const trees = TreeBuilder.fromInputParams([input]);
		return trees[0];
	}

	/**
	 * Set or add `paramName`'s tree to `newValue` (a scalar, an array, or a
	 * branch-path map), in an array of builders or of compiled `DataTree`s.
	 *
	 * Copy-on-write: returns a new array and never mutates the caller's, so assign
	 * the result.
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
	 * let trees = TreeBuilder.fromInputParams(io.inputs);
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

		// An empty array lands here too, so it gets a `DataTree` back, not a builder.
		const dataTrees = (trees as DataTree[]).slice();
		const compiled = builder.toComputeFormat();
		const idx = dataTrees.findIndex((t) => t.ParamName === paramName);
		if (idx !== -1) dataTrees[idx] = compiled;
		else dataTrees.push(compiled);
		return dataTrees;
	}

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
	 * Read `paramName`'s value from an array of builders or of compiled
	 * `DataTree`s (e.g. a solve response's `values`). One value comes back
	 * unwrapped (`5`, not `[5]`), several as an array, a missing param as `null`.
	 * A builder reads every branch; a `DataTree` only its first branch.
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
	 * const x = TreeBuilder.getTreeValue(result.values, 'X'); // Returns 42 (not [42])
	 * const points = TreeBuilder.getTreeValue(result.values, 'Points'); // Returns [point1, point2, ...]
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

	private static readFromBuilders(
		builders: TreeBuilder[],
		paramName: string
	): DataTreeValue[] | null {
		const tree = builders.find((t) => t.getParamName() === paramName);
		return tree ? tree.flatten() : null;
	}

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
	 * Parse a branch path like `"{0;1;2}"` into `[0, 1, 2]`.
	 *
	 * @throws {ComputeError} `INVALID_INPUT` for a malformed path, rather than
	 *   collapsing it to a default branch where two bad keys would merge.
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
		if (!match[1]) return [];
		return match[1].split(';').map(Number);
	}

	/** `[0, 1, 2]` → `"{0;1;2}"`. */
	public static formatPathString(path: number[]): DataTreePath {
		return `{${path.join(';')}}` as DataTreePath;
	}

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

	/** Booleans and numbers stay primitives: Grasshopper reads them typed. */
	private static serializeValue(value: DataTreeValue): string | boolean | number {
		if (typeof value === 'boolean') return value;
		if (typeof value === 'number') return value;
		if (typeof value === 'string') return value;
		if (typeof value === 'object' && value !== null) {
			return JSON.stringify(value);
		}
		return String(value);
	}

	private static deserializeValue(data: string | boolean | number): DataTreeValue {
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
		// those must come back numeric — but non-canonical numeric-looking
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
