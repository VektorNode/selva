import { RhinoComputeError, ErrorCodes } from '@/core/errors';
import type { ValueTransformer } from './parser-utils';

/**
 * Configuration for creating a value transformer
 */
export interface TransformerConfig<T> {
  /**
   * Parse from string representation
   */
  stringParser?: (value: string) => T | null;
  /**
   * Check if value is of the correct native type
   */
  directTypeCheck?: (value: unknown) => boolean;
  /**
   * Fallback coercion when string parsing and type check fail
   */
  coerce?: (value: unknown) => T | null;
  /**
   * Custom error message for invalid values (optional)
   */
  errorMessage?: (value: unknown) => string;
}

/**
 * Generic transformer factory that creates value transformers with consistent patterns
 * Reduces duplication across numeric, boolean, text, and object transformers.
 *
 * @internal This is an internal transformer factory module.
 *
 * @example
 * ```typescript
 * // Create a numeric transformer
 * const numericTransformer = createTransformer({
 *   stringParser: (s) => {
 *     const n = Number(s.trim());
 *     return Number.isNaN(n) ? null : n;
 *   },
 *   directTypeCheck: (v) => typeof v === 'number',
 * });
 *
 * // Create a boolean transformer with error handling
 * const booleanTransformer = createTransformer({
 *   stringParser: (s) => {
 *     const lower = s.toLowerCase();
 *     if (lower === 'true') return true;
 *     if (lower === 'false') return false;
 *     return null;
 *   },
 *   directTypeCheck: (v) => typeof v === 'boolean',
 *   errorMessage: (v) => `Invalid boolean value: ${v}`,
 * });
 * ```
 */
export function createTransformer<T>(config: TransformerConfig<T>): ValueTransformer<T> {
  return (value: unknown): T | null => {
    // Try string parsing first
    if (typeof value === 'string') {
      if (config.stringParser) {
        return config.stringParser(value);
      }
      // If no string parser, fall through to type check/coercion
    }

    // Try direct type check
    if (config.directTypeCheck?.(value)) {
      return value as T;
    }

    // Try coercion
    if (config.coerce) {
      return config.coerce(value);
    }

    return null;
  };
}

/**
 * Creates a numeric value transformer (for Number and Integer types)
 */
export function createNumericTransformer(): ValueTransformer<number> {
  return createTransformer({
    stringParser: (s) => {
      const parsed = Number(s.trim());
      return Number.isNaN(parsed) ? null : parsed;
    },
    directTypeCheck: (v) => typeof v === 'number',
  });
}

/**
 * Creates a boolean value transformer with optional error throwing
 */
export function createBooleanTransformer(throwOnInvalid: boolean = true): ValueTransformer<boolean> {
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
 */
export function createTextTransformer(): ValueTransformer<string> {
  return createTransformer({
    stringParser: (value) => {
      // Handle strings with both start and end quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
      }
      // Handle strings that start with quote but don't end with one (legacy behavior)
      if (value.startsWith('"')) {
        return value.slice(1, -1);
      }
      return value;
    },
  });
}

/**
 * Creates an object value transformer that parses JSON strings
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
