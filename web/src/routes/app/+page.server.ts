import type { PageServerLoad } from './$types';
import { fetchParsedDefinitionIO, solveGrasshopperDefinition, inputsToDataTrees, GrasshopperResponseProcessor } from "rhino-compute-core"
import type { UISchema } from '$lib/types/schema';

export const load = (async () => {

  const definition = await fetchParsedDefinitionIO("http://localhost:5173/builder_test.gh", { serverUrl: "http://localhost:5000/" });

  const tree = inputsToDataTrees(definition.inputs);

  const solvedDefinition = await solveGrasshopperDefinition(tree, "http://localhost:5173/builder_test.gh", { serverUrl: "http://localhost:5000/" });

  const values = new GrasshopperResponseProcessor(solvedDefinition).getValues();

  const schema = JSON.parse(values.values.schema) as UISchema;


  return {
    schema
  }


}) satisfies PageServerLoad;