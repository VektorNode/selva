import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { GrasshopperResponseProcessor, TreeBuilder, GrasshopperClient } from '@selva/core';
import type { UISchema } from '@selva/ui-shared';
import { getServerConfig } from '$lib/server/config.server';

export const load = (async ({ url, params }) => {
  const config = getServerConfig();

  // Get filename from URL param (only filename, not full URL)
  let ghFilename = params.definition || url.searchParams.get('gh') || config.ghDefinitionsBaseUrl;

  // Ensure extension
  if (!ghFilename.endsWith('.gh')) {
    ghFilename += '.gh';
  }

  // Construct full URL server-side (secret)
  const fullGhUrl = `${config.ghDefinitionsBaseUrl}${ghFilename}`;

  let client;

  try {
    client = await GrasshopperClient.create({ serverUrl: config.computeServerUrl });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(503, `Failed to connect to Rhino Compute server: ${errorMessage}`);
  }

  const definition = await client.getIO(fullGhUrl);

  // Solve with default values to get the schema
  const tree = TreeBuilder.fromInputParams(definition.inputs);

  const solvedDefinition = await client.solve(fullGhUrl, tree);

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
    ghDefinition: fullGhUrl, // Pass to client for compute calls
  };
}) satisfies PageServerLoad;
