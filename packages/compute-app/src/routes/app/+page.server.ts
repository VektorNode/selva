import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
	GrasshopperResponseProcessor,
	TreeBuilder,
	GrasshopperClient
} from 'selva-compute/grasshopper';
import type { UISchema } from '@selva/shared';
import { getServerConfig } from '$lib/server/config.server';
import { getDefinitionContainer, type Definition } from '$lib/server/definitions.server';
import path from 'node:path';

export const load = (async ({ url, params: _params }) => {
	const config = getServerConfig();
	const container = getDefinitionContainer();

	// Get filename from URL param (only filename, not full URL)
	let ghFilename = url.searchParams.get('gh');

	let definitionSource: Uint8Array | null = null;
	let clientDefUrl = '';

	// Load available definitions for switcher
	let availableDefinitions: Definition[] = [];
	let loadError: Error | null = null;
	try {
		availableDefinitions = await container.listDefinitions();
	} catch (err) {
		loadError = err instanceof Error ? err : new Error(String(err));
		console.warn('[App Load] Failed to load available definitions:', err);
	}

	// If no identifier provided, use first available definition's GUID
	if (!ghFilename && availableDefinitions.length > 0) {
		ghFilename = availableDefinitions[0].guid ?? availableDefinitions[0].filename;
	}

	if (!ghFilename) {
		let msg = 'No definitions available.';
		if (config.ghDefinitionsPath) {
			const configPath = path.join(config.ghDefinitionsPath, 'definitions-config.json');
			msg = `No definitions configured.\n\nPlease create a definitions-config.json file at:\n${configPath}\n\nSee definitions-config.example.json for the format.`;
			if (loadError) msg += `\n\nError details: ${loadError.message}`;
		} else {
			msg += ' Please configure GH_DEFINITIONS_PATH or GH_DEF_* environment variables.';
		}
		throw error(400, msg);
	}

	try {
		definitionSource = await container.loadDefinition(ghFilename);
		clientDefUrl = await container.getDefinitionUrl(ghFilename);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.warn(`[App Load] Failed to load definition '${ghFilename}':`, err);

		if (config.ghDefinitionsPath) {
			console.warn(` - If running in Docker, ensure volumes are mounted correctly.`);
			console.warn(
				` - If running in Vercel/Cloud, local file access is often restricted. Use the environment loader with GH_DEF_* variables instead.`
			);
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
				availableDefinitions,
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
