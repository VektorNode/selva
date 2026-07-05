import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema, UpdateMetadataInputSchema } from '@selvajs/platform/definitions';
import { GH_EXTENSIONS, MAX_GH_FILE_SIZE } from '$lib/server/admin-config';
import { resolveServerForOrg } from '$lib/server/compute/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';

// POST — upload a *new version* of an existing definition (spec §6).
// Advances `draft`; `live` is unchanged until publish.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');

	const formData = await request.formData();
	const file = formData.get('file');
	if (!(file instanceof File))
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'A Grasshopper (.gh or .ghx) file is required');

	const changeNoteRaw = formData.get('changeNote');
	const changeNote = typeof changeNoteRaw === 'string' ? changeNoteRaw.slice(0, 1000) : undefined;

	const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	if (!GH_EXTENSIONS.includes(ext)) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`
		);
	}
	if (file.size > MAX_GH_FILE_SIZE) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`File too large. Max size: ${MAX_GH_FILE_SIZE / (1024 * 1024)} MB`
		);
	}

	const { ctx, record, project } = await requireEditableDefinition(locals, guidParsed.data);
	const fileExt = ext.slice(1) as 'gh' | 'ghx';

	try {
		const data = new Uint8Array(await file.arrayBuffer());

		// Validate-and-cache gate: extract the schema from compute BEFORE any
		// write. Failure rejects the upload with nothing persisted.
		// See specs/SchemaCaching.md. `project` comes from the gate — no re-fetch (§2b).
		const server = await resolveServerForOrg(ctx, project?.orgId ?? null, {
			definitionPin: record.computeServerId ?? null
		});
		const schema = await fetchSchemaFromCompute(data, server);

		const version = await getDefinitionService().uploadVersion(
			ctx,
			guidParsed.data,
			data,
			fileExt,
			file.name,
			schema,
			changeNote
		);
		return json({ version }, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to upload definition version');
	}
};

// DELETE — soft-delete the entire definition (versions + blobs wiped).
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		await getDefinitionService().delete(ctx, guidParsed.data);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to delete definition');
	}
};

// PUT — update metadata only (no file change; use POST for that).
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	const body = await request.json().catch(() => null);
	const parsed = UpdateMetadataInputSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		await getDefinitionService().updateMeta(ctx, guidParsed.data, parsed.data);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to update definition');
	}
};
