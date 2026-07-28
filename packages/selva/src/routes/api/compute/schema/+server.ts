import {
	resolveServerForOrg,
	ComputeServerUnconfiguredError
} from '$lib/server/compute/resolve.server';
import { requireCanCreateDefinition } from '$lib/server/access.server';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { MAX_GH_FILE_SIZE } from '$lib/server/computeLimits';
import { camelcaseKeys } from '@selvajs/compute/core';
import type { UISchema } from '@selvajs/schemas';

// Multipart envelope (boundaries + Content-Disposition headers) adds a small
// constant overhead on top of the raw .gh bytes; 1 MB clears it comfortably.
const MULTIPART_OVERHEAD = 1024 * 1024;

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const projectId = url.searchParams.get('projectId');
	if (!projectId) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'projectId query parameter is required');
	}

	// Reject oversized uploads with the app's JSON error envelope *before* the
	// body is read. Without this, the only backstop is the adapter-node
	// BODY_SIZE_LIMIT (or an upstream proxy), which returns an opaque non-JSON
	// 413 — the client then can't read a message and shows a misleading
	// "Compute server error". This makes the real reason (file too large) loud.
	requireMaxBodySize(request, MAX_GH_FILE_SIZE + MULTIPART_OVERHEAD);

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
		if (err instanceof ComputeServerUnconfiguredError)
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
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
		apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, 'Compute server is unreachable');
	}

	if (!response.ok) {
		apiError(response.status, ApiErrorCode.COMPUTE_UNAVAILABLE, 'Compute server error');
	}

	// Compute returns [{ FileName, Schemas }] with PascalCase wrapper keys only.
	// The schema contents are already camelCase from our C# serializer, so we only
	// need a shallow camelcase to normalize FileName→fileName, Schemas→schemas.
	// deep:true would mangle user-defined option names (e.g. "Display3d" → "display3d").
	const raw = await response.json();
	const results: { schemas?: UISchema[]; error?: string }[] = camelcaseKeys(
		Array.isArray(raw) ? raw : [raw]
	) as { schemas?: UISchema[]; error?: string }[];
	const schemas = results.flatMap((r) => r.schemas ?? []);

	if (schemas.length === 0) {
		// Compute answers 200 with a per-file `error` field, so the !response.ok guard
		// above never fires for it. Prefer that diagnosis over the generic message.
		const diagnosis = results.map((r) => r.error).filter(Boolean);
		apiError(
			422,
			ApiErrorCode.UNPROCESSABLE,
			diagnosis.length > 0 ? diagnosis.join('\n') : 'No schemas found in definition'
		);
	}

	return new Response(JSON.stringify(schemas), {
		headers: { 'Content-Type': 'application/json' }
	});
};
