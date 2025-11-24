import type { InputParamSchema } from '../../../types';

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
 * // Process numeric input with transformer
 * processInputValue(input, {
 *   transform: createNumericTransformer()
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

// Re-export transformer factories from transformer-factory module
export {
  createTransformer,
  createNumericTransformer,
  createBooleanTransformer,
  createTextTransformer,
  createObjectTransformer,
} from './transformer-factory';
