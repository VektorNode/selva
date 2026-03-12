import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
	GrasshopperResponseProcessor,
	TreeBuilder,
	GrasshopperClient
} from 'selva-compute/grasshopper';
import type { UISchema } from '@selva/shared';
import { getServerConfig } from '$lib/server/compute/config.server';
import { getDefinitionContainer } from '$lib/server/definitions.server';

export const load = (async ({ url, params: _params }) => {
	const config = getServerConfig();
	const container = getDefinitionContainer();

	// Get filename from URL param (only filename, not full URL)
	const ghFilename = url.searchParams.get('gh');

	let definitionSource: Uint8Array | null = null;
	let clientDefUrl = '';

	if (!ghFilename) {
		throw error(
			400,
			`Missing 'gh' query parameter specifying the definition filename. Example usage: /app?gh=example.gh`
		);
	}

	try {
		definitionSource = await container.loadDefinition(ghFilename);
		clientDefUrl = await container.getDefinitionUrl(ghFilename);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.warn(`[App Load] Failed to load definition '${ghFilename}':`, err);

		if (config.ghDefinitionsPath) {
			console.warn(` - If running in Docker, ensure volumes are mounted correctly.`);
		}

		throw error(400, `Failed to load definition '${ghFilename}': ${errMsg}`);
	}

	let client;

	try {
		client = await GrasshopperClient.create({
			serverUrl: config.computeServerUrl,
			apiKey: config.computeApiKey
		});
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		const errorDetails = {
			message: errorMessage,
			computeServerUrl: config.computeServerUrl,
			timestamp: new Date().toISOString(),
			stack: process.env.NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined
		};

		console.error(
			'[PageLoad] Compute server connection failed:',
			JSON.stringify(errorDetails, null, 2)
		);

		error(503, `Failed to connect to Rhino Compute server: ${errorMessage}`);
	}

	try {
		const definition = await client.getIO(definitionSource);

		if (!definition) {
			throw new Error(
				`Failed to get definition IO - server returned undefined. Definition URL: ${clientDefUrl}`
			);
		}

		// Solve with default values to get the schema
		try {
			const tree = TreeBuilder.fromInputParams(definition.inputs);

			const solvedDefinition = await client.solve(definitionSource, tree);

			const responseProcessor = new GrasshopperResponseProcessor(solvedDefinition);
			const schema = responseProcessor.getValueByParamName('Schema', {
				parseValues: true
			}) as UISchema;

			if (!schema || !schema.inputs) {
				const availableParams =
					solvedDefinition.values?.map((v: any) => v.ParamName).join(', ') || 'none';
				throw new Error(
					`Failed to extract UI schema from computation response.\n` +
						`Available outputs: ${availableParams}\n` +
						`Schema value: ${JSON.stringify(schema)}\n\n` +
						`In Grasshopper, verify a Context Bake component with the output name 'Schema' is present and wired to the solver.`
				);
			}

			// Merge default values from Compute definition into schema inputs
			const computeInputsByParamId = new Map(definition.inputs.map((input) => [input.id, input]));

			schema.inputs = schema.inputs.map((schemaInput) => {
				const computeInput = computeInputsByParamId.get(schemaInput.id);

				// Special handling for Color parameters to convert default RGB/RGBA values to hex format
				if (computeInput?.paramType == 'Color' && computeInput.default !== undefined) {
					const toHex = (value: number) => value.toString(16).padStart(2, '0');
					const parts = String(computeInput.default)
						.split(',')
						.map((s) => parseInt(s.trim(), 10));

					if (parts.length === 3) {
						// RGB format
						computeInput.default = `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
					} else if (parts.length === 4) {
						// ARGB format - skip alpha
						computeInput.default = `#${toHex(parts[1])}${toHex(parts[2])}${toHex(parts[3])}`;
					}
				}

				if (computeInput && computeInput.default !== undefined) {
					return {
						...schemaInput,
						default: computeInput.default
					};
				}
				return schemaInput;
			});

			// Extract initial output values from the server-side solve
			const initialOutputs: Record<string, unknown> = {};
			for (const output of schema.outputs) {
				const value = responseProcessor.getValueByParamName(output.nickname, {
					parseValues: true
				});
				initialOutputs[output.id] = value;
			}

			return {
				schema,
				ghDefinition: clientDefUrl,
				currentDefinition: ghFilename ? ghFilename.replace(/\.gh$/, '') : '',
				initialOutputs,
				initialSolveResponse: solvedDefinition
			};
		} catch (innerErr) {
			console.error('[PageLoad] Inner computation failed:', innerErr);
			throw innerErr;
		}
	} catch (err) {
		const errorDetails = {
			message: err instanceof Error ? err.message : String(err),
			definitionUrl: clientDefUrl,
			timestamp: new Date().toISOString(),
			stack: process.env.NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined
		};

		console.error('[PageLoad] Definition loading failed:', JSON.stringify(errorDetails, null, 2));

		if (process.env.NODE_ENV === 'development') {
			const hint = `\n\nTroubleshooting:\n1. Check /api/health/compute to diagnose server connectivity\n2. Check the browser console for more details\n3. Check the server logs above for full error stack`;
			error(500, `Failed to load definition from ${clientDefUrl}: ${errorDetails.message}${hint}`);
		}

		throw error(
			500,
			`Failed to load definition: ${err instanceof Error ? err.message : String(err)}`
		);
	}
}) satisfies PageServerLoad;
