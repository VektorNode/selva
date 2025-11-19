import type { PageServerLoad } from './$types';
import {
	fetchParsedDefinitionIO,
	solveGrasshopperDefinition,
	inputsToDataTrees,
	GrasshopperResponseProcessor
} from 'rhino-compute-core';
import type { UISchema } from '$lib/types/generated';

export const load = (async () => {
	// Fetch the Grasshopper definition IO (includes paramId and default values)
	const definition = await fetchParsedDefinitionIO('http://localhost:5173/builder_test.gh', {
		serverUrl: 'http://localhost:5000/'
	});
	console.log('Fetched definition:', definition.inputs);

	// Solve with default values to get the schema
	const tree = inputsToDataTrees(definition.inputs);
	const solvedDefinition = await solveGrasshopperDefinition(
		tree,
		'http://localhost:5173/builder_test.gh',
		{ serverUrl: 'http://localhost:5000/' }
	);
	const values = new GrasshopperResponseProcessor(solvedDefinition).getValues();
	const schema = JSON.parse(values.values.schema) as UISchema;

	// Merge default values from Compute definition into schema inputs
	// The Compute definition has paramId, and schema has id (both are the same GUID)
	const computeInputsByParamId = new Map(definition.inputs.map((input) => [input.paramId, input]));

	schema.inputs = schema.inputs.map((schemaInput) => {
		const computeInput = computeInputsByParamId.get(schemaInput.id);
		if (computeInput && computeInput.default !== undefined) {
			return {
				...schemaInput,
				default: computeInput.default
			};
		}
		return schemaInput;
	});

	return {
		schema
	};
}) satisfies PageServerLoad;
