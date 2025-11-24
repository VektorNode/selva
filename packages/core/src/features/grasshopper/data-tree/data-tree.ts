import { DataTreeDefault, DataTreePath, InputParam, InnerTree } from '../types';

/**
 * Value types that can be stored in a DataTree
 */
export type DataTreeValue = string | number | boolean | object | null;

/**
 * Simple data item for compute requests (not to be confused with DataItem interface for responses).
 */
interface ComputeDataItem {
  data: string;
}

/**
 * InnerTree data structure for compute requests.
 */
type ComputeInnerTreeData = {
  [path in DataTreePath]: ComputeDataItem[];
};

/**
 * Standalone DataTree class for constructing Grasshopper DataTree structures.
 * Does not depend on RhinoCompute library.
 *
 * @example
 * ```ts
 * const tree = new DataTree('MyParam')
 *   .append([0], [1, 2, 3])
 *   .append([1], [4, 5])
 *   .toComputeFormat();
 * ```
 */
export class DataTree {
  private innerTree: ComputeInnerTreeData;
  private paramName: string;

  constructor(paramName: string) {
    this.paramName = paramName;
    this.innerTree = {} as ComputeInnerTreeData;
  }

  /**
   * Append values to a specific path in the tree.
   *
   * @param path - Array of integers representing the branch path (e.g., [0], [0, 1])
   * @param items - Values to append at this path
   * @returns this for method chaining
   */
  public append(path: number[], items: DataTreeValue[]): this {
    const pathKey = DataTree.formatPathString(path);

    if (!this.innerTree[pathKey]) {
      this.innerTree[pathKey] = [];
    }

    const dataItems: ComputeDataItem[] = items.map((item) => ({
      data: DataTree.serializeValue(item),
    }));

    this.innerTree[pathKey].push(...dataItems);
    return this;
  }

  /**
   * Append a single value to a path.
   *
   * @param path - Branch path
   * @param item - Single value to append
   * @returns this for method chaining
   */
  public appendSingle(path: number[], item: DataTreeValue): this {
    return this.append(path, [item]);
  }

  /**
   * Set values from a DataTreeDefault structure.
   * Replaces any existing tree data.
   *
   * @param treeData - DataTree structure with path keys like "{0;1}"
   * @returns this for method chaining
   */
  public fromDataTreeDefault(treeData: DataTreeDefault): this {
    this.innerTree = {} as ComputeInnerTreeData;

    for (const [pathStr, items] of Object.entries(treeData)) {
      if (!Array.isArray(items)) continue;
      const path = DataTree.parsePathString(pathStr);
      this.append(path, items);
    }

    return this;
  }

  /**
   * Append flattened values to path [0].
   * Useful for simple flat inputs.
   *
   * @param values - Single value or array of values
   * @returns this for method chaining
   */
  public appendFlat(values: DataTreeValue | DataTreeValue[]): this {
    const items = Array.isArray(values) ? values : [values];
    return this.append([0], items);
  }

  /**
   * Get the flattened list of all values in the tree.
   *
   * @returns Array of all values across all branches
   */
  public flatten(): DataTreeValue[] {
    const result: DataTreeValue[] = [];

    for (const items of Object.values(this.innerTree)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          result.push(DataTree.deserializeValue(item.data));
        }
      }
    }

    return result;
  }

  /**
   * Get all paths in the tree.
   *
   * @returns Array of path strings
   */
  public getPaths(): DataTreePath[] {
    return Object.keys(this.innerTree) as DataTreePath[];
  }

  /**
   * Get values at a specific path.
   *
   * @param path - Path to retrieve values from
   * @returns Array of values or undefined if path doesn't exist
   */
  public getPath(path: number[]): DataTreeValue[] | undefined {
    const pathKey = DataTree.formatPathString(path);
    const items = this.innerTree[pathKey];
    if (!items) return undefined;
    return items.map((item: ComputeDataItem) => DataTree.deserializeValue(item.data));
  }

  /**
   * Convert to format compatible with Grasshopper Compute API.
   *
   * @returns InnerTree object ready for compute
   */
  public toComputeFormat(): InnerTree {
    return {
      ParamName: this.paramName,
      InnerTree: this.innerTree as any, // Cast to any because request format differs from response type
    };
  }

  /**
   * Get the raw InnerTree data structure.
   *
   * @returns InnerTree data
   */
  public getInnerTree(): ComputeInnerTreeData {
    return this.innerTree;
  }

  /**
   * Get the parameter name.
   *
   * @returns Parameter name
   */
  public getParamName(): string {
    return this.paramName;
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  /**
   * Create DataTrees from an array of InputParam definitions.
   * Handles tree access, numeric constraints, and value parsing.
   *
   * @param inputs - Array of input parameter definitions
   * @returns Array of InnerTree instances ready for compute
   *
   * @example
   * ```ts
   * const trees = DataTree.fromInputParams(inputs);
   * ```
   */
  public static fromInputParams(inputs: InputParam[]): InnerTree[] {
    return inputs
      .filter((input) => DataTree.hasValidValue(input.default))
      .map((input) => {
        const tree = new DataTree(input.name);
        const value = input.default;

        // Handle tree access (complex DataTree structure)
        if (input.treeAccess && DataTree.isDataTreeStructure(value)) {
          tree.fromDataTreeDefault(value as DataTreeDefault);

          // Apply numeric constraints to tree items
          if (DataTree.isNumericInput(input)) {
            tree.applyNumericConstraints(input.minimum, input.maximum, input.name);
          }
        }
        // Handle flat inputs
        else {
          const values = Array.isArray(value) ? value : [value];
          const processed = DataTree.processValues(values, input);
          tree.appendFlat(processed);
        }

        return tree.toComputeFormat();
      });
  }

  /**
   * Create a DataTree from a single InputParam.
   *
   * @param input - Input parameter definition
   * @returns InnerTree ready for compute or undefined if value is invalid
   */
  public static fromInputParam(input: InputParam): InnerTree | undefined {
    if (!DataTree.hasValidValue(input.default)) return undefined;

    const trees = DataTree.fromInputParams([input]);
    return trees[0];
  }

  /**
   * Parse a DataTree path string like "{0;1;2}" into [0, 1, 2].
   *
   * @param pathStr - Path string
   * @returns Array of path indices
   */
  public static parsePathString(pathStr: string): number[] {
    const match = pathStr.match(/^\{([\d;]+)\}$/);
    if (!match) {
      console.warn(`Invalid DataTree path format: ${pathStr}, using [0]`);
      return [0];
    }
    return match[1].split(';').map(Number);
  }

  /**
   * Format a path array into DataTree path string format.
   *
   * @param path - Path as number array
   * @returns Formatted path string like "{0;1;2}"
   */
  public static formatPathString(path: number[]): DataTreePath {
    return `{${path.join(';')}}` as DataTreePath;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Apply numeric constraints to all tree values.
   */
  private applyNumericConstraints(
    min: number | null | undefined,
    max: number | null | undefined,
    inputName: string
  ): void {
    for (const items of Object.values(this.innerTree)) {
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        const value = DataTree.deserializeValue(item.data);
        if (typeof value === 'number') {
          const clamped = DataTree.clampValue(value, min, max, inputName);
          item.data = DataTree.serializeValue(clamped);
        }
      }
    }
  }

  /**
   * Infer the type of a value for Grasshopper.
   */
  private static inferType(value: DataTreeValue): string {
    if (typeof value === 'string') return 'System.String';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'System.Int32' : 'System.Double';
    }
    if (typeof value === 'boolean') return 'System.Boolean';
    if (typeof value === 'object' && value !== null) return 'System.Object';
    return 'System.String';
  }

  /**
   * Serialize a value to string format for compute.
   */
  private static serializeValue(value: DataTreeValue): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Deserialize a string value back to its original type.
   */
  private static deserializeValue(data: string): DataTreeValue {
    // Try to parse as JSON first
    if (data.startsWith('{') || data.startsWith('[')) {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    // Try to parse as number
    if (!isNaN(Number(data))) {
      return Number(data);
    }
    // Try to parse as boolean
    if (data === 'true') return true;
    if (data === 'false') return false;
    return data;
  }

  /**
   * Check if a value is valid for inclusion in a DataTree.
   */
  private static hasValidValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return true;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
      return false;
    return true;
  }

  /**
   * Check if value is a DataTree structure.
   */
  private static isDataTreeStructure(value: unknown): value is DataTreeDefault {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    return Object.entries(value).every(
      ([key, val]) => typeof key === 'string' && /^\{[\d;]+\}$/.test(key) && Array.isArray(val)
    );
  }

  /**
   * Check if input is numeric type.
   */
  private static isNumericInput(input: InputParam): input is InputParam & {
    paramType: 'Number' | 'Integer';
    minimum?: number | null;
    maximum?: number | null;
  } {
    return input.paramType === 'Number' || input.paramType === 'Integer';
  }

  /**
   * Process array of values based on input type.
   */
  private static processValues(values: DataTreeValue[], input: InputParam): DataTreeValue[] {
    return values
      .map((val) => {
        // Apply numeric constraints
        if (DataTree.isNumericInput(input) && typeof val === 'number') {
          return DataTree.clampValue(val, input.minimum, input.maximum, input.name);
        }

        // Keep objects and strings as-is (serialization happens in append)
        return val;
      })
      .filter((v) => v !== null && v !== undefined);
  }

  /**
   * Clamp numeric value to constraints.
   */
  private static clampValue(
    value: number,
    min: number | null | undefined,
    max: number | null | undefined,
    inputName: string
  ): number {
    let result = value;

    if (min !== null && min !== undefined && result < min) {
      console.warn(`${inputName}: ${value} below min ${min}, clamping`);
      result = min;
    }
    if (max !== null && max !== undefined && result > max) {
      console.warn(`${inputName}: ${value} above max ${max}, clamping`);
      result = max;
    }

    return result;
  }
}
