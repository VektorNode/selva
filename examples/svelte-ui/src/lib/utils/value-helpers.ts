import type { DataTreeDefault } from '@selva/core/grasshopper';

/**
 * Type guard to check if a value is a DataTree structure
 */
export function isDataTree<T>(value: unknown): value is DataTreeDefault<T> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Generic value update helper that handles single values, arrays, and DataTrees
 */
export function updateValue<T>(
  currentValue: T | T[] | DataTreeDefault<T>,
  newValue: T,
  index?: number,
  branch?: string
): T | T[] | DataTreeDefault<T> {
  // Single value
  if (typeof currentValue !== 'object' || currentValue === null) {
    return newValue;
  }

  // Array
  if (Array.isArray(currentValue) && index !== undefined) {
    return currentValue.map((v, i) => (i === index ? newValue : v)) as T[];
  }

  // DataTree
  if (isDataTree<T>(currentValue) && branch && index !== undefined) {
    const branchArray = (currentValue as Record<string, T[]>)[branch] ?? [];
    return {
      ...currentValue,
      [branch]: branchArray.map((v, i) => (i === index ? newValue : v)),
    } as DataTreeDefault<T>;
  }

  return currentValue;
}

/**
 * Type-safe value getter for arrays and DataTrees
 */
export function getValue<T>(
  value: T | T[] | DataTreeDefault<T>,
  index?: number,
  branch?: string
): T | undefined {
  if (Array.isArray(value) && index !== undefined) {
    return value[index];
  }

  if (isDataTree<T>(value) && branch && index !== undefined) {
    const branchArray = (value as Record<string, T[]>)[branch];
    return branchArray?.[index];
  }

  if (typeof value !== 'object' || value === null) {
    return value as T;
  }

  return undefined;
}

/**
 * Get all entries from a value (for rendering loops)
 */
export type ValueEntry<T> = {
  value: T;
  index: number;
  branch?: string;
};

export function getValueEntries<T>(value: T | T[] | DataTreeDefault<T>): ValueEntry<T>[] {
  // Single value
  if (typeof value !== 'object' || value === null) {
    return [{ value: value as T, index: 0 }];
  }

  // Array
  if (Array.isArray(value)) {
    return value.map((v, index) => ({ value: v, index }));
  }

  // DataTree
  if (isDataTree<T>(value)) {
    const entries: ValueEntry<T>[] = [];
    for (const [branch, arr] of Object.entries(value)) {
      if (Array.isArray(arr)) {
        arr.forEach((v, index) => {
          entries.push({ value: v as T, index, branch });
        });
      }
    }
    return entries;
  }

  return [];
}
