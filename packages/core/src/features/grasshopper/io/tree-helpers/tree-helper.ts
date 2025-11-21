import RhinoCompute from 'compute-rhino3d';

import { DataTree, DataTreeDefault, InputParam, GroupInputs } from '../../types';

/**
 * Converts GhInputType array directly to DataTree format for compute.
 * Handles both flat inputs and complex DataTree structures based on treeAccess flag.
 *
 * @public Use this to convert user inputs to DataTree format for compute operations.
 */
export function inputsToDataTrees(inputs: InputParam[]): DataTree[] {
  return inputs
    .filter((input) => {
      const value = input.default;
      if (value === undefined || value === null) return false;
      // Allow empty strings for Text parameters
      if (typeof value === 'string') return true;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
        return false;
      return true;
    })
    .map((input) => {
      const tree = new RhinoCompute.Grasshopper.DataTree(input.name);
      const value = input.default;

      // Handle tree access (complex DataTree structure)
      if (input.treeAccess && typeof value === 'object' && !Array.isArray(value)) {
        const treeData = value as DataTreeDefault;

        for (const [pathStr, items] of Object.entries(treeData)) {
          if (!Array.isArray(items)) continue;

          // Parse path from "{0;1;2}" to [0, 1, 2]
          const path = parseDataTreePath(pathStr);

          // Apply numeric constraints to each item if needed
          const processedItems = items.map((item) => {
            if (
              (input.paramType === 'Number' || input.paramType === 'Integer') &&
              typeof item === 'number'
            ) {
              return clampNumericValue(item, input.minimum, input.maximum, input.name);
            }
            return item;
          });

          tree.append(path, processedItems);
        }
      }
      // Handle flat inputs (single value or array)
      else {
        // Ensure value is an array
        const values = Array.isArray(value) ? value : [value];

        // Apply numeric constraints
        const processedValues = values
          .map((val) => {
            if (
              (input.paramType === 'Number' || input.paramType === 'Integer') &&
              typeof val === 'number'
            ) {
              return clampNumericValue(val, input.minimum, input.maximum, input.name);
            }
            // Stringify objects (but not primitives)
            if (typeof val === 'object' && val !== null) {
              try {
                return JSON.stringify(val);
              } catch (error) {
                console.warn(`Failed to stringify value in ${input.name}:`, error);
                return null;
              }
            }
            return val;
          })
          .filter((v) => v !== null);

        if (processedValues.length > 0) {
          tree.append([0], processedValues);
        }
      }

      return tree as DataTree;
    })
    .filter((tree): tree is DataTree => tree !== undefined);
}

/**
 * Parse a DataTree path string like "{0;1;2}" into an array [0, 1, 2]
 */
function parseDataTreePath(pathStr: string): number[] {
  const match = pathStr.match(/^\{([\d;]+)\}$/);
  if (!match) {
    console.warn(`Invalid DataTree path format: ${pathStr}, using [0] as fallback`);
    return [0];
  }
  return match[1].split(';').map(Number);
}

/**
 * Clamp a numeric value to min/max constraints
 */
function clampNumericValue(
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

/**
 * Converts a GroupInputs object to DataTrees, with updated values.
 *
 * @public Use this to convert grouped inputs to DataTree format for compute operations.
 *
 * @param groupedInputs - The grouped inputs object.
 * @param currentValues - Record of current input values by input name.
 * @returns Array of DataTree instances, ready for compute.
 */
export function groupedInputsToDataTrees(
  groupedInputs: GroupInputs,
  currentValues?: Record<string, any>
): DataTree[] {
  // Flatten all GhInputType arrays from each group
  const allInputs: InputParam[] = Object.values(groupedInputs).flatMap((group) => group.inputs);

  // If currentValues provided, update the defaults
  const updatedInputs = currentValues
    ? allInputs.map((input) => ({
        ...input,
        default: currentValues[input.name] ?? input.default,
      }))
    : allInputs;

  return inputsToDataTrees(updatedInputs);
}

/**
 * Replaces the value of a DataTree with the given param name in a list of DataTrees.
 * If the param is found, its value is updated (at path [0]).
 * Returns a new array with the updated DataTrees.
 *
 * @param trees - Array of DataTree objects
 * @param paramName - The name of the parameter to update
 * @param newValue - The new value to set (array or single value)
 */
export function replaceTreeValue(trees: DataTree[], paramName: string, newValue: any): DataTree[] {
  const existingIndex = trees.findIndex((tree) => tree.data.ParamName === paramName);

  let innerTreeValue: any;

  // Check if newValue is already an InnerTree structure
  if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
    // Check if it has "{0}" or "0" keys (InnerTree format)
    if ('{0}' in newValue) {
      innerTreeValue = newValue;
    } else if ('0' in newValue) {
      // Normalize "0" to "{0}"
      innerTreeValue = { '{0}': newValue['0'] };
    } else {
      // It's a plain object, wrap it
      innerTreeValue = { '{0}': [{ data: newValue }] };
    }
  } else if (Array.isArray(newValue)) {
    // Array value - wrap in InnerTree format
    innerTreeValue = { '{0}': newValue };
  } else {
    // Scalar value - wrap in array with data object
    innerTreeValue = { '{0}': [{ data: newValue.toString() }] };
  }

  if (existingIndex !== -1) {
    // Update existing tree
    trees[existingIndex].data.InnerTree = innerTreeValue;
  } else {
    // Create new tree
  }

  return trees;
}

/**
 * Checks if the given object is a valid DataTree structure.
 * A DataTree should be an object whose keys are path strings like "{0;1;2}" and values are arrays.
 *
 * @public Use this type guard to validate DataTree structures at runtime.
 */
export function isDataTreeStructure(obj: unknown): obj is DataTreeDefault {
  if (typeof obj !== 'object' || obj === null) return false;
  return Object.entries(obj).every(
    ([key, value]) => typeof key === 'string' && /^\{[\d;]+\}$/.test(key) && Array.isArray(value)
  );
}

/**
 * Build a single DataTree from a name and value.
 * Useful for dynamic/runtime input construction.
 *
 * @public Use this for low-level runtime DataTree construction. For most use cases, prefer `inputsToDataTrees()`.
 */
export function buildDataTree(name: string, value: any): any {
  const tree = new RhinoCompute.Grasshopper.DataTree(name);
  tree.append([0], [value]);
  return tree;
}
