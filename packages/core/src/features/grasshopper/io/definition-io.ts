import { ComputeConfig, RhinoComputeError } from '@/core';
import { fetchRhinoCompute } from '@/core/compute-fetch/compute-fetch';
import { camelcaseKeys, warnIfClientSide } from '@/core/utils';

import {
  InputParam,
  GrasshopperParsedIO,
  GrasshopperParsedIORaw,
  IoResponseSchema,
} from '../types';

import { processInputs } from './input/input-parsers/input-processors';

/**
 * Fetches raw input/output schemas from a Grasshopper definition.
 * Returns unprocessed data exactly as received from the Rhino Compute API (camelCased).
 *
 * @param definitionUrl - URL of the Grasshopper definition
 * @param config - Compute configuration (server URL, API key, etc.)
 * @returns Raw inputs and outputs with no type processing
 * @throws {RhinoComputeError} If fetch fails or response is invalid
 *
 * @internal Use `fetchParsedDefinitionIO()` for processed, type-safe inputs
 */
export async function fetchDefinitionIO(
  definitionUrl: string,
  config: ComputeConfig
): Promise<GrasshopperParsedIORaw> {
  const response = await fetchRhinoCompute<'io'>('io', { pointer: definitionUrl }, config);

  if (!response || typeof response !== 'object') {
    throw new RhinoComputeError('Invalid IO response structure', undefined, {
      context: { response, definitionUrl },
    });
  }

  // Validate structure
  if (!response || typeof response !== 'object') {
    throw new RhinoComputeError('Invalid IO response structure', undefined, {
      context: { response, definitionUrl },
    });
  }

  // Convert PascalCase to camelCase
  const camelCased = camelcaseKeys(response, { deep: true }) as IoResponseSchema;

  return {
    inputs: camelCased.inputs,
    outputs: camelCased.outputs,
  };
}

/**
 * Fetches and processes input/output schemas from a Grasshopper definition.
 * Returns strongly-typed, validated input parameters ready for use.
 *
 * @public This is the recommended way to fetch definition I/O schemas.
 *
 * @param definitionUrl - URL of the Grasshopper definition
 * @param config - Compute configuration (server URL, API key, etc.)
 * @returns Processed inputs with discriminated union types and outputs
 * @throws {RhinoComputeError} If fetch fails or response is invalid
 *
 * @example
 * ```typescript
 * const { inputs, outputs } = await fetchParsedDefinitionIO(
 *   'https://example.com/definition.gh',
 *   { serverUrl: 'https://compute.rhino3d.com', apiKey: 'YOUR_KEY' }
 * );
 *
 * // Inputs are now strongly typed
 * inputs.forEach(input => {
 *   if (input.paramType === 'Number') {
 *     console.log(input.minimum, input.maximum); // TypeScript knows these exist
 *   }
 * });
 * ```
 */
export async function fetchParsedDefinitionIO(
  definitionUrl: string,
  config: ComputeConfig
): Promise<GrasshopperParsedIO> {
  warnIfClientSide('fetchParsedDefinitionIO', config.suppressClientSideWarning);

  const { inputs: rawInputs, outputs } = await fetchDefinitionIO(definitionUrl, config);
  const inputs: InputParam[] = processInputs(rawInputs);

  return { inputs, outputs };
}
