import { getServerConfig } from '$lib/server/compute/config.server';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { camelcaseKeys } from 'selva-compute/core';
import type { UISchema } from 'selva-shared';

export const POST: RequestHandler = async ({ request }) => {
	const config = getServerConfig();
	const formData = await request.formData();

	const schemaUrl = new URL('/grasshopper/schema', config.computeServerUrl).toString();

	const headers: Record<string, string> = {};
	if (config.computeApiKey) {
		headers['RhinoComputeKey'] = config.computeApiKey;
	}

	let response: Response;
	try {
		response = await fetch(schemaUrl, { method: 'POST', headers, body: formData });
	} catch {
		throw error(503, 'Compute server is unreachable');
	}

	if (!response.ok) {
		throw error(response.status as 400 | 500 | 502, 'Compute server error');
	}

	// Compute returns [{ FileName, Schemas }] with PascalCase wrapper keys only.
	// The schema contents are already camelCase from our C# serializer, so we only
	// need a shallow camelcase to normalize FileName→fileName, Schemas→schemas.
	// deep:true would mangle user-defined option names (e.g. "Display3d" → "display3d").
	const raw = await response.json();
	const results: { schemas: UISchema[] }[] = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as {
		schemas: UISchema[];
	}[];
	const schemas = results.flatMap((r) => r.schemas ?? []);

	if (schemas.length === 0) {
		throw error(422, 'No schemas found in definition');
	}

	return new Response(JSON.stringify(schemas), {
		headers: { 'Content-Type': 'application/json' }
	});
};
