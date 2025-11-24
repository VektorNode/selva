import type { PageServerLoad } from './$types';
import {
  fetchParsedDefinitionIO,
  solveGrasshopperDefinition,
  GrasshopperResponseProcessor,
  DataTree,
} from '@computebuilder/core';
import type { UISchema } from '$lib/types/generated';
import { PUBLIC_COMPUTE_SERVER_URL, PUBLIC_GH_DEFINITION } from '$env/static/public';

export const load = (async () => {
  // Fetch the Grasshopper definition IO (includes paramId and default values)
  const definition = await fetchParsedDefinitionIO(PUBLIC_GH_DEFINITION, {
    serverUrl: PUBLIC_COMPUTE_SERVER_URL,
  });

  // Solve with default values to get the schema
  const tree = DataTree.fromInputParams(definition.inputs);
  //TODO: For the ui uilder make it inherit from the ContextComponent and then we can use the default value
  const solvedDefinition = await solveGrasshopperDefinition(
    tree,
    PUBLIC_GH_DEFINITION,
    { serverUrl: PUBLIC_COMPUTE_SERVER_URL }
  );

  const schema = new GrasshopperResponseProcessor(solvedDefinition).getValueByParamName('Schema', { parseValues: true }) as UISchema;

  // Merge default values from Compute definition into schema inputs
  // The Compute definition has paramId, and schema has id (both are the same GUID)
  const computeInputsByParamId = new Map(definition.inputs.map((input) => [input.id, input]));

  schema.inputs = schema.inputs.map((schemaInput) => {
    const computeInput = computeInputsByParamId.get(schemaInput.id);
    if (computeInput && computeInput.default !== undefined) {
      return {
        ...schemaInput,
        default: computeInput.default,
      };
    }
    return schemaInput;
  });

  return {
    schema,
  };
}) satisfies PageServerLoad;
