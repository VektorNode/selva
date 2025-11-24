import { ValidationErrors } from '@/core/errors';

import type { InputParamSchema } from '../../../types';

/**
 * Processes a ValueList input parameter.
 *
 * Validates that the values object exists and contains at least one entry.
 *
 * @param input - The raw input parameter schema
 * @throws {RhinoComputeError} If values object is missing or empty
 * @internal
 */
export default function processValueListInput(input: InputParamSchema): void {
  if (!input.values || typeof input.values !== 'object' || Object.keys(input.values).length === 0) {
    throw ValidationErrors.missingValues(input.name, 'ValueList');
  }

  // Validate that default is one of the available values (if default exists)
  if (input.default !== undefined && input.default !== null) {
    const valueExists = Object.values(input.values).includes(input.default);
    if (!valueExists) {
      console.warn(
        `ValueList input "${input.name}" default value "${input.default}" is not in available values`
      );
    }
  }
}
