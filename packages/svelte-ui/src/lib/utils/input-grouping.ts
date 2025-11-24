import {
  InputParam,
  GroupInputs,
  NestedGroupInputs,
  NestedGroupNode,
} from '../../../../core/src/features/grasshopper/types.js';

/**
 * Groups input parameters by their `groupName` property.
 *
 * @public Use this to organize inputs by groups for UI generation.
 *
 * @param inputs - Array of input parameters to group
 * @param options - Grouping behavior options
 * @param options.showUngrouped - Whether to include inputs without a group (default: `true`)
 * @param options.ungroupedName - Group name for ungrouped inputs (default: `"Default"`)
 * @param options.capitalize - Whether to capitalize group names (default: `false`)
 * @returns Object mapping group keys to their inputs
 *
 * @remarks
 * - Inputs with a `groupName` are grouped under a normalized key (lowercased, no spaces)
 * - Inputs without a `groupName` are grouped under the `ungroupedName`
 * - Groups named "hidden" or "hide" are unified under the key `__hidden__`
 * - If `showUngrouped` is `false`, inputs without a group are excluded
 * - Group keys are normalized: spaces removed, lowercased (unless `capitalize` is `true`)
 *
 * @example
 * ```typescript
 * const inputs = [
 *   { groupName: 'Geometry', name: 'points', ... },
 *   { groupName: 'Settings', name: 'tolerance', ... },
 *   { groupName: null, name: 'misc', ... }
 * ];
 *
 * const grouped = groupInputs(inputs, {
 *   showUngrouped: true,
 *   ungroupedName: 'Other',
 *   capitalize: true
 * });
 * // Result:
 * // {
 * //   "Geometry": { inputs: [...] },
 * //   "Settings": { inputs: [...] },
 * //   "Other": { inputs: [...] }
 * // }
 * ```
 */
export function groupInputs(
  inputs: InputParam[],
  options?: {
    showUngrouped?: boolean;
    ungroupedName?: string;
    capitalize?: boolean;
  }
): GroupInputs {
  const groupedInputs: GroupInputs = {};
  const showUngrouped = options?.showUngrouped ?? true;
  const ungroupedName = options?.ungroupedName ?? 'Default';
  const ungroupedKey = ungroupedName.replace(/\s+/g, '').toLowerCase();

  for (const input of inputs) {
    const hasGroup = !!input.groupName && input.groupName.trim() !== '';
    const rawKey = hasGroup ? input.groupName.trim() : ungroupedName;
    let cleanedKey = rawKey.replace(/\s+/g, '').toLowerCase();

    // Optionally skip ungrouped inputs
    if (!hasGroup && !showUngrouped) {
      continue;
    }

    //Unify hidden group names
    if (cleanedKey === 'hidden' || cleanedKey === 'hide') {
      cleanedKey = '__hidden__';
    } else if (options?.capitalize) {
      // Capitalize the first letter of each word for display
      cleanedKey = cleanedKey.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
    }

    if (!groupedInputs[cleanedKey]) {
      groupedInputs[cleanedKey] = { inputs: [] };
    }

    // If the input has no group and an ungroupedName is provided,
    // set the input's groupName to the ungroupedName (without mutating original)
    const shouldSetUngroupedName =
      !hasGroup && ungroupedName !== null && ungroupedName.trim() !== '';
    const inputToPush = shouldSetUngroupedName ? { ...input, groupName: ungroupedName } : input;

    groupedInputs[cleanedKey].inputs.push(inputToPush);
  }

  // If no groups, return an empty group with the chosen name
  if (Object.keys(groupedInputs).length === 0 && showUngrouped) {
    groupedInputs[ungroupedKey] = { inputs: [] };
  }

  return groupedInputs;
}

/**
 * Groups input parameters by their nested `groupName` property (supports :: separator).
 *
 * @public Use this to organize inputs by nested hierarchical groups for UI generation.
 *
 * @param inputs - Array of input parameters to group
 * @param options - Grouping behavior options
 * @param options.separator - Separator for nested groups (default: `"::"`)
 * @param options.showUngrouped - Whether to include inputs without a group (default: `true`)
 * @param options.ungroupedName - Group name for ungrouped inputs (default: `"Default"`)
 * @returns Object mapping top-level group keys to their nested structure
 *
 * @remarks
 * - Inputs with nested `groupName` like "Layer_1::Layer_2::Layer_3" are organized in a tree structure
 * - Each level can contain both inputs and child groups
 * - Groups named "hidden" or "hide" at any level are excluded
 * - Empty intermediate groups are preserved in the hierarchy
 *
 * @example
 * ```typescript
 * const inputs = [
 *   { groupName: 'Layer_1', name: 'num1', ... },
 *   { groupName: 'Layer_1::Layer_2', name: 'num2', ... },
 *   { groupName: 'Layer_1::Layer_2::Layer_3', name: 'num3', ... }
 * ];
 *
 * const nested = groupInputsNested(inputs);
 * // Result: Tree structure with Layer_1 containing Layer_2, which contains Layer_3
 * ```
 */
export function groupInputsNested(
  inputs: InputParam[],
  options?: {
    separator?: string;
    showUngrouped?: boolean;
    ungroupedName?: string;
  }
): NestedGroupInputs {
  const separator = options?.separator ?? '::';
  const showUngrouped = options?.showUngrouped ?? true;
  const ungroupedName = options?.ungroupedName ?? 'Default';
  const rootGroups: NestedGroupInputs = {};

  for (const input of inputs) {
    const hasGroup = !!input.groupName && input.groupName.trim() !== '';

    // Skip ungrouped inputs if option is false
    if (!hasGroup && !showUngrouped) {
      continue;
    }

    // Parse the group path
    const groupPath = hasGroup ? input.groupName.trim() : ungroupedName;
    const parts = groupPath
      .split(separator)
      .map((p) => p.trim())
      .filter((p) => p !== '');

    // Skip hidden groups at any level
    const isHidden = parts.some((part) => {
      const lower = part.toLowerCase();
      return lower === 'hidden' || lower === 'hide';
    });

    if (isHidden) {
      continue;
    }

    // If no parts (empty group name), use ungrouped name
    if (parts.length === 0) {
      parts.push(ungroupedName);
    }

    // Build the nested structure
    let currentLevel = rootGroups;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}${separator}${part}` : part;

      // Initialize root level
      if (i === 0) {
        if (!currentLevel[part]) {
          currentLevel[part] = {
            name: part,
            path: currentPath,
            inputs: [],
            children: new Map(),
          };
        }

        // If this is the final level, add the input
        if (i === parts.length - 1) {
          currentLevel[part].inputs.push(input);
        } else {
          // Move to children for next iteration
          currentLevel = currentLevel[part].children as any;
        }
      } else {
        // Handle nested levels
        const parent = currentLevel as any as Map<string, NestedGroupNode>;

        if (!parent.has(part)) {
          parent.set(part, {
            name: part,
            path: currentPath,
            inputs: [],
            children: new Map(),
          });
        }

        const node = parent.get(part);
        if (!node) {
          continue;
        }

        // If this is the final level, add the input
        if (i === parts.length - 1) {
          node.inputs.push(input);
        } else {
          // Move to children for next iteration
          currentLevel = node.children as any;
        }
      }
    }
  }

  return rootGroups;
}
