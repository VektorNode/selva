import type { InputParamSchema } from '../../../types';
import { RhinoComputeError, ErrorCodes } from '@/core/errors';

/**
 * Type for a single value transformer function
 */
export type ValueTransformer<T> = (value: unknown) => T | null;

/**
 * Options for processing input values
 */
export interface ProcessValueOptions<T> {
  /**
   * Function to transform a single value
   */
  transform: ValueTransformer<T>;
  /**
   * Whether to set default to undefined if all values fail transformation
   * @default true
   */
  setUndefinedOnEmpty?: boolean;
}

/**
 * Generic utility to process input default values (arrays or single values)
 * This eliminates the duplication across numeric, boolean, text, and object parsers.
 *
 * @internal This is an internal implementation detail used by input parsers.
 *
 * @param input - The input parameter schema to process
 * @param options - Processing options with transform function
 *
 * @example
 * ```typescript
 * // Process numeric input
 * processInputValue(input, {
 *   transform: (value) => {
 *     if (typeof value === 'string') {
 *       const parsed = Number(value.trim());
 *       return Number.isNaN(parsed) ? null : parsed;
 *     }
 *     return typeof value === 'number' ? value : null;
 *   }
 * });
 * ```
 */
export function processInputValue<T>(
  input: InputParamSchema,
  options: ProcessValueOptions<T>
): void {
  const { transform, setUndefinedOnEmpty = true } = options;

  // Don't process undefined or null - preserve them as is
  if (input.default === undefined || input.default === null) {
    return;
  }

  if (Array.isArray(input.default)) {
    const processedArray = input.default.map(transform).filter((v): v is T => v !== null);

    // For arrays, always set to undefined if empty (regardless of setUndefinedOnEmpty)
    input.default = processedArray.length > 0 ? processedArray : undefined;
  } else {
    const transformed = transform(input.default);
    if (transformed !== null) {
      // Transformation succeeded
      input.default = transformed;
    } else {
      // Transformation failed - set to undefined only if setUndefinedOnEmpty is true
      if (setUndefinedOnEmpty) {
        input.default = undefined;
      }
      // Otherwise preserve original value
    }
  }
}

/**
 * Creates a numeric value transformer
 *
 * @internal This is an internal transformer factory used by numeric parsers.
 */
export function createNumericTransformer(): ValueTransformer<number> {
  return (value: unknown): number | null => {
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isNaN(parsed) ? null : parsed;
    }
    return typeof value === 'number' ? value : null;
  };
}

/**
 * Creates a boolean value transformer
 *
 * @internal This is an internal transformer factory used by boolean parsers.
 */
export function createBooleanTransformer(
  throwOnInvalid: boolean = true
): ValueTransformer<boolean> {
  return (value: unknown): boolean | null => {
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      if (lowerValue === 'true') return true;
      if (lowerValue === 'false') return false;
      if (throwOnInvalid) {
        throw new RhinoComputeError(
          `Invalid boolean value: ${value}`,
          ErrorCodes.VALIDATION_ERROR,
          { context: { receivedValue: value, expectedValues: ['true', 'false'] } }
        );
      }
      return null;
    }
    return typeof value === 'boolean' ? value : null;
  };
}

/**
 * Creates a text value transformer that removes surrounding quotes
 *
 * @internal This is an internal transformer factory used by text parsers.
 */
export function createTextTransformer(): ValueTransformer<string> {
  return (value: unknown): string | null => {
    if (typeof value === 'string') {
      // Handle strings with both start and end quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
      }
      // Handle strings that start with quote but don't end with one (legacy behavior)
      if (value.startsWith('"')) {
        return value.slice(1, -1);
      }
      return value;
    }
    return null;
  };
}

/**
 * Creates an object value transformer that parses JSON strings
 *
 * @internal This is an internal transformer factory used by object parsers.
 */
export function createObjectTransformer(inputName: string = 'unknown'): ValueTransformer<object> {
  return (value: unknown): object | null => {
    if (typeof value === 'string' && value.trim() !== '') {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
        console.warn(`Parsed value for input ${inputName} is not an object`);
        return null;
      } catch (err) {
        console.warn(`Failed to parse object value "${value}" for input ${inputName}`, err);
        return null;
      }
    }
    return typeof value === 'object' && value !== null ? (value as object) : null;
  };
}
