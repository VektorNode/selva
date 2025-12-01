import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
  GrasshopperResponseProcessor,
  DataTree,
  GrasshopperClient,
} from '@selva/core';
import type { UISchema } from '$lib/types/generated';
import { PUBLIC_COMPUTE_SERVER_URL, PUBLIC_GH_DEFINITION } from '$env/static/public';

export const load = (async () => {
  let client;

  try {
    client = await GrasshopperClient.create({ serverUrl: PUBLIC_COMPUTE_SERVER_URL });
  } catch (err) {
    error(503, {
      message: `Failed to connect to Rhino Compute server at ${PUBLIC_COMPUTE_SERVER_URL}`,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  const definition = await client.getIO(PUBLIC_GH_DEFINITION);
  console.log('Fetched GH definition:', definition);

  // Solve with default values to get the schema
  const tree = DataTree.fromInputParams(definition.inputs);
  const solvedDefinition = await client.solve(PUBLIC_GH_DEFINITION, tree);

  const schema = new GrasshopperResponseProcessor(solvedDefinition).getValueByParamName('Schema', {
    parseValues: true,
  }) as UISchema;

  // Merge default values from Compute definition into schema inputs
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
