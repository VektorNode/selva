import { resolveServerForOrg, ComputeServerUnconfiguredError } from '@selvajs/server/compute';
import { requireCanCreateDefinition, scoped } from '$lib/server/access.server';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { MAX_DEFINITION_FILE_SIZE } from '$lib/server/computeLimits';
import {
	assertCamelCaseSchema,
	postSchemaFormData,
	SchemaExtractionError
} from '@selvajs/server/definitions';

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
	requireMaxBodySize(request, MAX_DEFINITION_FILE_SIZE + MULTIPART_OVERHEAD);

	// Same gate as POST /api/definitions: container projects need owner/editor;
	// commons projects (`autoJoinOnUpload=true`) accept any authenticated user.
	// Eliminates the random-authenticated-drain path the auth-only check left open.
	const { project } = await requireCanCreateDefinition(scoped(locals), projectId);

	// Pin to the same server the upload will use, so schema extraction runs on
	// the server that later solves the definition - not the org/global default.
	// No record exists yet, so the pin comes from the client's selection.
	const computeServerId = url.searchParams.get('computeServerId');

	let server;
	try {
		server = await resolveServerForOrg(
			locals.ctx!,
			project.orgId,
			locals.providers.data.computeServer,
			{ definitionPin: computeServerId }
		);
	} catch (err) {
		if (err instanceof ComputeServerUnconfiguredError)
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
		throw err;
	}
	const formData = await request.formData();

	let results;
	try {
		results = await postSchemaFormData(formData, server);
	} catch (err) {
		if (err instanceof SchemaExtractionError) {
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
		}
		throw err;
	}
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

	// `postSchemaFormData` already normalized the casing, so what survives to here
	// is a schema with no readable `inputs` at all. Upload is a hard gate: letting
	// it through creates a definition that renders empty, and the client cannot
	// tell that from a definition that genuinely has no inputs.
	try {
		schemas.forEach(assertCamelCaseSchema);
	} catch (err) {
		if (err instanceof SchemaExtractionError) {
			apiError(422, ApiErrorCode.UNPROCESSABLE, err.message);
		}
		throw err;
	}

	return new Response(JSON.stringify(schemas), {
		headers: { 'Content-Type': 'application/json' }
	});
};
