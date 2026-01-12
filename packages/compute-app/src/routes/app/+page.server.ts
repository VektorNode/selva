import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { GrasshopperResponseProcessor, TreeBuilder, GrasshopperClient } from '@selva/core';
import type { UISchema } from '@selva/shared';
import { getServerConfig } from '$lib/server/config.server';
import { loadDefinitionsConfig, type Definition } from '$lib/server/definitions.server';
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
	if (config.ghDefinitionsPath) {
		try {
			availableDefinitions = await loadDefinitionsConfig();
		} catch (err) {
			console.warn('[App Load] Failed to load available definitions:', err);
		}
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
			throw error(
				400,
				`No definitions configured.\n\nPlease create a definitions-config.json file at:\n${configPath}\n\nSee definitions-config.example.json for the format.`
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
					` - If running in Vercel/Cloud, local file access is often restricted. Consider using GH_DEFINITIONS_BASE_URL instead.`
				);

				// Fall through to URL strategy if text logic fails
			}
		}
	}

	// Strategy 2: Remote URL (Fallback or Legacy)
	if (!definitionSource) {
		let fullGhUrl: string;

		if (ghFilename) {
			if (!ghFilename.endsWith('.gh')) ghFilename += '.gh';

			// If we have a base URL, use it
			let baseUrl = config.ghDefinitionsBaseUrl || '';

			// If config URL looks like a file, strip the filename
			if (baseUrl.endsWith('.gh')) {
				baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
			}

			if (baseUrl) {
				if (!baseUrl.endsWith('/')) baseUrl += '/';
				fullGhUrl = `${baseUrl}${ghFilename}`;
			} else {
				// No base URL configured, cant resolve
				throw error(404, 'Definition not found locally and no base URL configured');
			}
		} else {
			// Use the default from config
			fullGhUrl = config.ghDefinitionsBaseUrl || '';
			if (!fullGhUrl) {
				const msg = config.ghDefinitionsPath
					? `No definition specified. Please add a .gh file to '${config.ghDefinitionsPath}' or use ?gh=filename`
					: 'No definition specified and no default configured';
				throw error(400, msg);
			}
		}

		definitionSource = fullGhUrl;
		clientDefUrl = fullGhUrl;
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

		// Development: include detailed error info
		if (process.env.NODE_ENV === 'development') {
			error(
				503,
				`Failed to connect to Rhino Compute server at ${config.computeServerUrl}: ${errorMessage}\n\nDebug info:\n${JSON.stringify(errorDetails, null, 2)}`
			);
		}

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

			const schema = new GrasshopperResponseProcessor(solvedDefinition).getValueByParamName(
				'Schema',
				{
					parseValues: true
				}
			) as UISchema;

			if (!schema || !schema.inputs) {
				throw new Error(
					`Failed to extract schema from computation response. Schema: ${JSON.stringify(schema)}`
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
