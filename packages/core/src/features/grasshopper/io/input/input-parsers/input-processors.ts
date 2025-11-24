import { ErrorCodes, RhinoComputeError } from '@/core/errors';

import processBooleanInput from './boolean-parser';
import processNumericInput from './numeric-parser';
import parseToObject from './object-parser';
import processTextInput from './text-parser';
import processValueListInput from './valuelist_parser';

import type {
  BaseInputType,
  BooleanInputType,
  GeometryInputType,
  InputParam,
  NumericInputType,
  InputParamSchema,
  TextInputType,
  ValueListInputType,
} from '../../../types';

function preProcessRawInput(input: InputParamSchema): void {
  if (typeof input.default === 'object' && input.default !== null) {
    if (input.default.innerTree) {
      const innerTree = input.default.innerTree;

      // If innerTree is empty, set default to undefined
      if (Object.keys(innerTree).length === 0) {
        input.default = undefined;
        return;
      }

      // If treeAccess is true or atMost > 1, preserve the tree structure
      if (input.treeAccess || (input.atMost && input.atMost > 1)) {
        // Convert each branch to an array of parsed data
        const tree: Record<string, any[]> = {};
        for (const [branch, items] of Object.entries(innerTree)) {
          tree[branch] = (items as any[]).map((item) => {
            // Try to parse numbers, booleans, or JSON if possible
            if (typeof item.data === 'string') {
              if (item.type === 'System.Double' || item.type === 'System.Int32') {
                const num = Number(item.data);
                return Number.isNaN(num) ? item.data : num;
              }
              if (item.type === 'System.Boolean') {
                return item.data.toLowerCase() === 'true';
              }
              if (item.type.startsWith('Rhino.Geometry') || item.type === 'System.String') {
                try {
                  return JSON.parse(item.data);
                } catch {
                  return item.data;
                }
              }
            }
            return item.data;
          });
        }
        input.default = tree;
        return;
      }

      // Otherwise, flatten all values as before
      const allValues: any[] = [];
      for (const items of Object.values(innerTree)) {
        if (Array.isArray(items)) {
          items.forEach((item) => {
            if (item && typeof item === 'object' && 'data' in item) {
              allValues.push(item.data);
            }
          });
        }
      }
      if (allValues.length === 0) {
        input.default = undefined;
      } else if (allValues.length === 1) {
        input.default = allValues[0];
      } else {
        input.default = allValues;
      }
    } else {
      console.warn('Unexpected structure in input.default:', input.default);
      input.default = null;
    }
  }
}

/**
 * Creates a safe default InputType when processing fails
 */
function createSafeDefault(rawInput: InputParamSchema, baseInput: BaseInputType): InputParam {
  switch (rawInput.paramType) {
    case 'Number':
    case 'Integer':
      return {
        ...baseInput,
        paramType: rawInput.paramType,
        minimum: rawInput.minimum,
        maximum: rawInput.maximum,
        atLeast: rawInput.atLeast,
        atMost: rawInput.atMost,
        default: rawInput.atMost > 1 ? [0] : 0,
      } as NumericInputType;
    case 'Boolean':
      return {
        ...baseInput,
        paramType: 'Boolean',
        default: rawInput.atMost > 1 ? [false] : false,
      } as BooleanInputType;
    case 'Text':
      return {
        ...baseInput,
        paramType: 'Text',
        default: rawInput.atMost > 1 ? [''] : '',
      } as TextInputType;
    case 'ValueList':
      return {
        ...baseInput,
        paramType: 'ValueList',
        values: rawInput.values ?? {},
        default: rawInput.atMost > 1 ? [rawInput.default] : rawInput.default,
      } as ValueListInputType;
    default:
      return {
        ...baseInput,
        paramType: 'Geometry',
        default: rawInput.atMost > 1 ? [null] : null,
      } as GeometryInputType;
  }
}

/**
 * Processes a raw input parameter schema and converts it into a typed InputParam object.
 *
 * @internal This is an internal processor. Use `fetchParsedDefinitionIO()` to get processed inputs instead.
 *
 * This function handles the transformation of raw input parameter data from Grasshopper into
 * a structured, type-safe format. It performs validation, type-specific processing, and error
 * handling for various parameter types including numeric, boolean, text, geometry, point, and line inputs.
 *
 * @param rawInput - The raw input parameter schema to process
 * @returns A fully processed and typed InputParam object with appropriate type-specific properties
 *
 * @throws {RhinoComputeError} When an unknown paramType is encountered
 * @throws {Error} Re-throws any non-RhinoComputeError exceptions
 *
 * @remarks
 * The function performs the following operations:
 * - Extracts base properties common to all input types
 * - Preprocesses the raw input data
 * - Applies type-specific validation and transformation
 * - Handles errors gracefully by creating safe default values for validation errors
 *
 * Supported parameter types:
 * - `Number` and `Integer`: Numeric inputs with optional min/max constraints
 * - `Boolean`: Boolean flag inputs
 * - `Text`: String inputs
 * - `Geometry`: Generic geometry objects
 * - `Point`: 3D point objects
 * - `Line`: Line objects
 *
 * @example
 * ```typescript
 * const rawInput = {
 *   name: 'Length',
 *   paramType: 'Number',
 *   minimum: 0,
 *   maximum: 100,
 *   default: 50
 * };
 * const processedInput = processInput(rawInput);
 * ```
 */
export function processInput(rawInput: InputParamSchema): InputParam {
  // Create base properties outside try-catch so it's accessible in catch block
  const baseInput: BaseInputType = {
    description: rawInput.description,
    name: rawInput.name,
    nickname: rawInput.nickname,
    treeAccess: rawInput.treeAccess,
    groupName: rawInput.groupName ?? '',
    id: rawInput.id,
  };

  try {
    // Handle default object processing
    preProcessRawInput(rawInput);

    // Type-specific processing and return typed result
    switch (rawInput.paramType) {
      case 'Number':
      case 'Integer': {
        processNumericInput(rawInput);
        return {
          ...baseInput,
          paramType: rawInput.paramType,
          minimum: rawInput.minimum,
          maximum: rawInput.maximum,
          atLeast: rawInput.atLeast,
          atMost: rawInput.atMost,
          stepSize: rawInput.stepSize,
          default: rawInput.default as number | undefined,
        } as NumericInputType;
      }
      case 'Boolean': {
        processBooleanInput(rawInput);
        return {
          ...baseInput,
          paramType: 'Boolean',
          default: rawInput.default as boolean | undefined,
        } as BooleanInputType;
      }
      case 'Text': {
        processTextInput(rawInput);
        return {
          ...baseInput,
          paramType: 'Text',
          default: rawInput.default as string | undefined,
        } as TextInputType;
      }
      case 'ValueList': {
        processValueListInput(rawInput);
        return {
          ...baseInput,
          paramType: 'ValueList',
          values: rawInput.values as Record<string, string>,
          default: rawInput.default as string | undefined,
        } as ValueListInputType;
      }
      case 'Geometry': {
        parseToObject(rawInput);
        return {
          ...baseInput,
          paramType: rawInput.paramType as 'Geometry',
          default: rawInput.default as object | string | undefined,
        } as GeometryInputType;
      }


      default:
        throw new RhinoComputeError(`Unknown paramType: ${rawInput.paramType}`, ErrorCodes.VALIDATION_ERROR, {
          context: { receivedParamType: rawInput.paramType, paramName: rawInput.name },
        });
    }
  } catch (error) {
    if (error instanceof RhinoComputeError) {
      console.error(`Validation error for input ${rawInput.name || 'unknown'}:`, error.message);
      // Return a safe default based on paramType
      return createSafeDefault(rawInput, baseInput);
    } else {
      // Transform unexpected errors
      throw new RhinoComputeError(
        error instanceof Error ? error.message : String(error),
        ErrorCodes.VALIDATION_ERROR,
        {
          context: { paramName: rawInput.name, paramType: rawInput.paramType },
          originalError: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }
}

/**
 * Processes raw Grasshopper input schemas into strongly-typed TypeScript interfaces.
 *
 * @internal This is an internal batch processor. Use `fetchParsedDefinitionIO()` to get processed inputs instead.
 *
 * Transforms each raw input parameter by:
 * - Normalizing default values (flattening data trees, parsing primitives)
 * - Applying type-specific parsing (Number, Text, Boolean, Geometry, etc.)
 * - Validating constraints (min/max, required fields)
 * - Converting to discriminated union types for type safety
 *
 * @param rawInputs - Array of raw input schemas from Rhino Compute API
 * @returns Array of processed, strongly-typed input parameters
 *
 * @remarks
 * - Empty data trees are converted to `undefined`
 * - Single values are extracted from arrays when appropriate
 * - Tree structures are preserved for list/tree access parameters
 * - Invalid inputs fall back to safe defaults with console warnings
 *
 * @example
 * ```typescript
 * const rawInputs = [
 *   { paramType: 'Number', name: 'radius', minimum: 0, default: 10 },
 *   { paramType: 'Text', name: 'label', default: 'Hello' }
 * ];
 *
 * const processed = processInputs(rawInputs);
 * // Result: [
 * //   { paramType: 'Number', name: 'radius', minimum: 0, default: 10, ... },
 * //   { paramType: 'Text', name: 'label', default: 'Hello', ... }
 * // ]
 *
 * // Now type-safe:
 * if (processed[0].paramType === 'Number') {
 *   console.log(processed[0].minimum); // TypeScript knows this exists
 * }
 * ```
 *
 * @see {@link processInput} for individual input processing logic
 * @see {@link preProcessRawInput} for default value normalization
 */
export function processInputs(rawInputs: InputParamSchema[]): InputParam[] {
  return rawInputs.map((rawInput) => processInput(rawInput));
}
