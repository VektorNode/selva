import {
	resolveServerForOrg,
	ComputeServerUnconfiguredError
} from '$lib/server/compute/resolve.server';
import { requireCanCreateDefinition } from '$lib/server/access.server';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { camelcaseKeys } from '@selvajs/compute/core';
import type { UISchema } from '@selvajs/schemas';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const projectId = url.searchParams.get('projectId');
	if (!projectId) {
		throw error(400, 'projectId query parameter is required');
	}

	// Same gate as POST /api/definitions: container projects need owner/editor;
	// commons projects (`autoJoinOnUpload=true`) accept any authenticated user.
	// Eliminates the random-authenticated-drain path the auth-only check left open.
	const { project } = await requireCanCreateDefinition(locals, projectId);

	// Pin to the same server the upload will use, so schema extraction runs on
	// the server that later solves the definition - not the org/global default.
	// No record exists yet, so the pin comes from the client's selection.
	const computeServerId = url.searchParams.get('computeServerId');

	let server;
	try {
		server = await resolveServerForOrg(locals.ctx!, project.orgId, {
			definitionPin: computeServerId
		});
	} catch (err) {
		if (err instanceof ComputeServerUnconfiguredError) throw error(503, err.message);
		throw err;
	}
	const formData = await request.formData();

	const schemaUrl = new URL('/grasshopper/schema', server.serverUrl).toString();

	const headers: Record<string, string> = {};
	if (server.apiKey) {
		headers['RhinoComputeKey'] = server.apiKey;
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
