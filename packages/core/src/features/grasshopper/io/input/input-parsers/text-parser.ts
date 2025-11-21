import { createTextTransformer, processInputValue } from './parser-utils';

import type { InputParamSchema } from '../../../types';

/**
 * Processes text input parameters
 *
 * @internal This is an internal parser used by `processInput()`. Use `fetchParsedDefinitionIO()` instead.
 */
export default function processTextInput(input: InputParamSchema): void {
  processInputValue(input, {
    transform: createTextTransformer(),
    setUndefinedOnEmpty: false, // Preserve non-string values
  });
}
