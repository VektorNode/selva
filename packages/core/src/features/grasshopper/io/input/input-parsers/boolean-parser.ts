import { RhinoComputeError } from '@/core/errors';

import { createBooleanTransformer, processInputValue } from './parser-utils';

import type { InputParamSchema } from '../../../types';

/**
 * Processes boolean input parameters
 *
 * @internal This is an internal parser used by `processInput()`. Use `fetchParsedDefinitionIO()` instead.
 */
export default function processBooleanInput(input: InputParamSchema): void {
  try {
    processInputValue(input, {
      transform: createBooleanTransformer(true),
      setUndefinedOnEmpty: false, // Preserve non-boolean values
    });
  } catch (error) {
    // Re-throw as RhinoComputeError for consistency
    if (error instanceof Error) {
      throw new RhinoComputeError(error.message);
    }
    throw error;
  }
}
