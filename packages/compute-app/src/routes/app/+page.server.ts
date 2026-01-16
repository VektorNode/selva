import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { GrasshopperResponseProcessor, TreeBuilder, GrasshopperClient } from 'selva-compute/grasshopper';
import type { UISchema } from '@selva/shared';
import { getServerConfig } from '$lib/server/config.server';
import { getDefinitionContainer, type Definition } from '$lib/server/definitions.server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const load = (async ({ url, params: _params }) => {
	const config = getServerConfig();

	// Get filename from URL param (only filename, not full URL)
	let ghFilename = url.searchParams.get('gh');

	let definitionSource: string | Uint8Array = '';
	let clientDefUrl = ''; // Value passed to client for subsequent API calls

	// Load available definitions for switcher
	let availableDefinitions: Definition[] = [];
	let loadError: Error | null = null;
	try {
		const container = getDefinitionContainer();
		availableDefinitions = await container.listDefinitions();
	} catch (err) {
		loadError = err instanceof Error ? err : new Error(String(err));
		console.warn('[App Load] Failed to load available definitions:', err);
	}

	// Strategy 1: Local File System (Preferred for safety)
	if (config.ghDefinitionsPath) {
		// If no filename is provided, use the first available definition from config
		if (!ghFilename && availableDefinitions.length > 0) {
			ghFilename = availableDefinitions[0].filename;
		}

		// If still no filename and no definitions configured, throw helpful error
		if (!ghFilename && availableDefinitions.length === 0) {
			const configPath = path.join(config.ghDefinitionsPath, 'definitions-config.json');
			const detail = loadError ? `\n\nError details: ${loadError.message}` : '';
			throw error(
				400,
				`No definitions configured.\n\nPlease create a definitions-config.json file at:\n${configPath}\n\nSee definitions-config.example.json for the format.${detail}`
			);
		}

		if (ghFilename) {
			// Normalize filename
			if (!ghFilename.endsWith('.gh')) ghFilename += '.gh';

			// Security: Prevent directory traversal
			const safeFilename = path.basename(ghFilename);
			if (safeFilename !== ghFilename || !/^[a-zA-Z0-9_\-.]+$/.test(safeFilename)) {
				throw error(400, 'Invalid filename');
			}

			const filePath = path.join(config.ghDefinitionsPath, safeFilename);

			try {
				// Check if file exists and read it
				await fs.access(filePath);
				const fileBuffer = await fs.readFile(filePath);
				definitionSource = new Uint8Array(fileBuffer);
				clientDefUrl = `local:${safeFilename}`;
			} catch {
				console.warn(
					`[Strategy: Local] Failed to read definition '${safeFilename}' at '${filePath}'.`
				);
				console.warn(` - If running in Docker, ensure volumes are mounted correctly.`);
				console.warn(
					` - If running in Vercel/Cloud, local file access is often restricted. Use the environment loader with GH_DEF_* variables instead.`
				);

				// Unable to load definition
			}
		}
	}

	// Strategy 2: Environment Variables (for cloud deployments)
	if (!definitionSource && availableDefinitions.length > 0) {
		// If no filename is provided, use the first available definition
		if (!ghFilename) {
			ghFilename = availableDefinitions[0].filename;
		}

		try {
			const container = getDefinitionContainer();
			const defUrl = await container.getDefinitionUrl(ghFilename);

			// Load definition from URL
			const response = await fetch(defUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch definition: ${response.statusText}`);
			}
			definitionSource = new Uint8Array(await response.arrayBuffer());
			clientDefUrl = defUrl;
		} catch (err) {
			console.warn(
				`[Strategy: Environment] Failed to load definition '${ghFilename}' from environment loader.`
			);
			console.warn(err);
		}
	}

	// If no definition source was found, fail
	if (!definitionSource) {
		const msg = availableDefinitions.length > 0
			? `Failed to load definition '${ghFilename || availableDefinitions[0].filename}'`
			: `No definitions available. Please configure GH_DEFINITIONS_PATH or GH_DEF_* environment variables.`;
		throw error(400, msg);
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
			const schema = responseProcessor.getValueByParamName(
				'Schema',
				{
					parseValues: true
				}
			) as UISchema;

			if (!schema || !schema.inputs) {
				const availableParams = solvedDefinition.values?.map((v: any) => v.ParamName).join(', ') || 'none';
				throw new Error(
					`Failed to extract schema from computation response. \nAvailable outputs: ${availableParams}\nSchema value: ${JSON.stringify(schema)}`
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

			return {
				schema,
				ghDefinition: clientDefUrl,
				currentDefinition: ghFilename ? ghFilename.replace(/\.gh$/, '') : '',
				availableDefinitions
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

		// Development: include detailed error info and hint
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
