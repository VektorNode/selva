import { DataTreeDefault, DataTreePath, InputParam, DataTree, InnerTreeData } from '../types';
import { ComputeError, ErrorCodes, getLogger } from '@/core';
import { readField } from '@/core/utils/read-field';
import { booleanTransformer, numericTransformer } from '../io/input/transformers';
import { isDataTreeDefault, TREE_PATH_RE } from './tree-path';

export type DataTreeValue = string | number | boolean | object | null;

/** One input's value for {@link TreeBuilder.fromValues}. */
export interface TreeValueEntry {
	paramName: string;
	/** Matched case-insensitively. */
	paramType: string;
	/** A scalar, an array (branch `{0}`), or a branch-path map like `{ '{0;1}': [1, 2] }`. */
	value: unknown;
	minimum?: number | null;
	maximum?: number | null;
}

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
		const branch = (this.innerTree[TreeBuilder.formatPathString(path)] ??= []);
		// A loop, not push(...items): spreading a few hundred thousand items overflows the stack.
		for (const item of items) branch.push({ data: TreeBuilder.serializeValue(item) });
		return this;
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

	/** The tree in the shape a solve request sends. */
	public toComputeFormat(): DataTree {
		return {
			ParamName: this.paramName,
			// `DataTree` types the response item shape; a request item is looser.
			InnerTree: this.innerTree as unknown as InnerTreeData
		};
	}

	public getParamName(): string {
		return this.paramName;
	}

	/**
	 * One tree per input that has a default, keyed by its nickname. Defaults are coerced and
	 * clamped by the same rules as {@link TreeBuilder.fromValues}.
	 */
	public static fromInputParams(inputs: InputParam[]): DataTree[] {
		return TreeBuilder.fromValues(
			inputs.map((input) => ({
				paramName: input.nickname || 'unnamed',
				paramType: input.paramType,
				value: input.default,
				...('minimum' in input && { minimum: input.minimum, maximum: input.maximum })
			}))
		);
	}

	/**
	 * One tree per entry, coercing UI values the way Grasshopper reads them. Number and Integer
	 * items go through the numeric coercion (Integer rounds) and are clamped to
	 * `minimum`/`maximum`; Boolean items also accept `'true'`/`'false'`; every other type passes
	 * through. An item that fails coercion is dropped with a warning. An entry left with no items
	 * is omitted, so Grasshopper uses its own value; `''` is an item, not an empty value.
	 */
	public static fromValues(entries: TreeValueEntry[]): DataTree[] {
		const trees: DataTree[] = [];

		for (const entry of entries) {
			const tree = new TreeBuilder(entry.paramName);
			const coerce = TreeBuilder.itemCoercer(entry);

			for (const [path, items] of TreeBuilder.branchesOf(entry.value)) {
				const kept: DataTreeValue[] = [];
				for (const item of items) {
					if (item === null || item === undefined) continue;
					const coerced = coerce(item);
					if (coerced === null) {
						getLogger().warn(
							`${entry.paramName}: dropped an item that is not a valid ${entry.paramType}`
						);
					} else {
						kept.push(coerced);
					}
				}
				if (kept.length > 0) tree.append(path, kept);
			}

			if (Object.keys(tree.innerTree).length > 0) trees.push(tree.toComputeFormat());
		}

		return trees;
	}

	private static branchesOf(value: unknown): [number[], unknown[]][] {
		if (!TreeBuilder.hasValidValue(value)) return [];
		if (isDataTreeDefault(value)) {
			return Object.entries(value).map(([path, items]) => [
				TreeBuilder.parsePathString(path),
				items as unknown[]
			]);
		}
		return [[[0], Array.isArray(value) ? value : [value]]];
	}

	/** `null` means the item was rejected. */
	private static itemCoercer(entry: TreeValueEntry): (item: unknown) => DataTreeValue | null {
		const { paramName, minimum, maximum } = entry;
		const paramType = entry.paramType.toLowerCase();

		if (paramType === 'number' || paramType === 'integer') {
			return (item) => {
				const n = numericTransformer(item);
				if (n === null) return null;
				const value = paramType === 'integer' ? Math.round(n) : n;
				return TreeBuilder.clampValue(value, minimum, maximum, paramName);
			};
		}
		if (paramType === 'boolean') return booleanTransformer;
		return (item) => item as DataTreeValue;
	}

	/**
	 * Set or add `paramName`'s tree to `newValue`: a scalar, an array (branch `{0}`), or a
	 * branch-path map. Copy-on-write: returns a new array and leaves the caller's untouched, so
	 * assign the result.
	 */
	public static replaceTreeValue(
		trees: DataTree[],
		paramName: string,
		newValue: DataTreeValue
	): DataTree[] {
		const compiled = TreeBuilder.buildFromValue(paramName, newValue).toComputeFormat();
		const result = trees.slice();
		const idx = result.findIndex((t) => TreeBuilder.paramNameOf(t) === paramName);
		if (idx === -1) result.push(compiled);
		else result[idx] = compiled;
		return result;
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
	 * `paramName`'s whole tree from a solve result's `values`, keyed by branch path (`'{0;1}'`).
	 * `null` when no tree has that param, an empty `Map` when it has no branches. An item without
	 * `data` reads as `null` in place, so indices don't shift.
	 */
	public static getTree(
		trees: DataTree[],
		paramName: string
	): Map<DataTreePath, DataTreeValue[]> | null {
		const tree = trees.find((t) => TreeBuilder.paramNameOf(t) === paramName);
		if (!tree) return null;

		const branches = new Map<DataTreePath, DataTreeValue[]>();
		const inner = readField(tree, 'InnerTree');
		if (!inner || typeof inner !== 'object') return branches;

		for (const [path, items] of Object.entries(inner)) {
			if (!Array.isArray(items)) continue;
			branches.set(
				path as DataTreePath,
				items.map((item) =>
					item?.data !== undefined ? TreeBuilder.deserializeValue(item.data) : null
				)
			);
		}
		return branches;
	}

	/**
	 * `paramName`'s value when its tree has a single branch: one item unwrapped (`5`, not `[5]`),
	 * several as an array. `null` for a missing param or an empty tree.
	 *
	 * @throws {ComputeError} `INVALID_INPUT` when the tree has more than one branch; read those
	 *   with {@link TreeBuilder.getTree}.
	 */
	public static getTreeValue(trees: DataTree[], paramName: string): DataTreeValue | null {
		const tree = TreeBuilder.getTree(trees, paramName);
		if (!tree || tree.size === 0) return null;
		if (tree.size > 1) {
			throw new ComputeError(
				`"${paramName}" has ${tree.size} branches; read it with TreeBuilder.getTree`,
				ErrorCodes.INVALID_INPUT,
				{ context: { paramName, branchCount: tree.size } }
			);
		}

		const [items] = tree.values();
		if (items.length === 0) return null;
		return items.length === 1 ? items[0] : items;
	}

	private static paramNameOf(tree: DataTree): unknown {
		return readField(tree, 'ParamName');
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

	private static deserializeValue(data: unknown): DataTreeValue {
		if (typeof data !== 'string') return data as DataTreeValue;

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
