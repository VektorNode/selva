import type { RequestHandler } from './$types';
import {
	type NumericInputType,
	type TextInputType,
	type BooleanInputType,
	type InputParam,
	TreeBuilder,
	GrasshopperClient
} from '@selva/core';
import type { SchemaInput } from '@selva/shared';
import { error, json } from '@sveltejs/kit';
import { getServerConfig } from '$lib/server/config.server';
import fs from 'node:fs/promises';
import path from 'node:path';

interface ComputeRequest {
	inputs: (SchemaInput & { minimum?: number; maximum?: number; stepSize?: number })[];
	values: Record<string, unknown>;
	definitionUrl: string;
}

/**
 * Transform input parameter to Rhino Compute format
 */
function transformInputParameter(
	input: SchemaInput & { minimum?: number; maximum?: number; stepSize?: number },
	value: unknown
): InputParam {
	const base = {
		description: input.description || '',
		name: input.nickname,
		nickname: input.nickname || null,
		id: input.id
	};

	if (input.paramType === 'number' || input.paramType === 'integer') {
		return {
			...base,
			paramType: input.paramType === 'integer' ? 'Integer' : 'Number',
			minimum: input.minimum,
			maximum: input.maximum,
			stepSize: input.paramType === 'integer' ? 1 : input.stepSize,
			default: value ?? input.default
		} as NumericInputType;
	} else if (input.paramType === 'text') {
		return {
			...base,
			paramType: 'Text',
			default: (value as string) ?? input.default ?? ''
		} as TextInputType;
	} else if (input.paramType === 'boolean') {
		return {
			...base,
			paramType: 'Boolean',
			default: (value as boolean) ?? input.default ?? false
		} as BooleanInputType;
	}

	return {
		...base,
		paramType: 'Text',
		default: (value as string) ?? ''
	} as TextInputType;
}

export const POST: RequestHandler = async ({ request }) => {
	let definitionUrl: string = '';
	const config = getServerConfig();

	try {
		const body: ComputeRequest = await request.json();

		const { inputs, values } = body;
		definitionUrl = body.definitionUrl;

		if (!inputs || !values || !definitionUrl) {
			throw error(400, 'Missing required fields: inputs, values, or definitionUrl');
		}

		// Determine definition source
		let definitionSource: string | Uint8Array = definitionUrl;

		if (definitionUrl.startsWith('local:')) {
			const filename = definitionUrl.substring(6);
			if (!config.ghDefinitionsPath) {
				throw error(500, 'Local definitions not configured on server');
			}

			// Security validation
			const safeFilename = path.basename(filename);
			if (safeFilename !== filename || !/^[a-zA-Z0-9_\-.]+$/.test(safeFilename)) {
				throw error(400, 'Invalid definition filename');
			}

			const filePath = path.join(config.ghDefinitionsPath, safeFilename);
			try {
				const fileData = await fs.readFile(filePath);
				definitionSource = new Uint8Array(fileData);
			} catch (err) {
				console.error(`Failed to read local definition: ${filePath}`, err);
				throw error(404, `Definition '${filename}' not found`);
			}
		}

		const inputTree = TreeBuilder.fromInputParams(
			inputs
				.filter((input) => input.paramType)
				.map((input) => transformInputParameter(input, values[input.id]))
		);

		// Use server-side COMPUTE_SERVER_URL (not PUBLIC_)
		const client = await GrasshopperClient.create({
			serverUrl: config.computeServerUrl,
			apiKey: config.computeApiKey
		});
		const solvedDefinition = await client.solve(definitionSource, inputTree);

		return json(solvedDefinition);
	} catch (err) {
		const errorDetails = {
			message: err instanceof Error ? err.message : 'Unknown error',
			timestamp: new Date().toISOString(),
			computeServerUrl: config.computeServerUrl,
			definitionUrl,
			stack: process.env.NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined
		};

		console.error('[API/Compute] Error:', JSON.stringify(errorDetails, null, 2));

		// Return detailed error response in development mode
		if (process.env.NODE_ENV === 'development') {
			throw error(
				500,
				JSON.stringify({
					error: 'Grasshopper computation failed',
					details: errorDetails,
					hint: 'Check /api/health/compute for server connectivity details'
				})
			);
		}

		// Production: generic error message
		if (err instanceof Error) {
			throw error(500, err.message);
		}

		throw error(500, 'Failed to solve Grasshopper definition');
	}
};
