import { createObjectTransformer, processInputValue } from './parser-utils';

import type { InputParamSchema } from '../../../types';

/**
 * Processes object input parameters by parsing JSON strings
 *
 * @internal This is an internal parser used by `processInput()`. Use `fetchParsedDefinitionIO()` instead.
 */
export default function parseToObject(input: InputParamSchema): void {
  processInputValue(input, {
    transform: createObjectTransformer(input.name),
    setUndefinedOnEmpty: true,
  });
}
