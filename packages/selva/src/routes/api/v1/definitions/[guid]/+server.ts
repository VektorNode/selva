import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionMeta, getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema, UpdateMetadataInputSchema } from '@selvajs/platform/definitions';
import { getVisibleDefinition } from '$lib/server/definitions/visibility.server';

// GET — the record plus its live/draft version summaries.
export const GET: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');
	if (!locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	try {
		const record = await getVisibleDefinition(locals.ctx, guidParsed.data);
		if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');

		const meta = getDefinitionMeta();
		const [liveVersion, draftVersion] = await Promise.all([
			record.liveVersionId ? meta.getVersion(locals.ctx, record.liveVersionId) : null,
			record.draftVersionId ? meta.getVersion(locals.ctx, record.draftVersionId) : null
		]);

		// Version summaries only — `schema` is a large blob served on demand by
		// `/versions/{versionId}/schema`.
		return json({
			...record,
			liveVersion: liveVersion ? versionSummary(liveVersion) : null,
			draftVersion: draftVersion ? versionSummary(draftVersion) : null
		});
	} catch (err) {
		handleApiError(err, 'Failed to load definition');
	}
};

function versionSummary(v: import('@selvajs/platform').DefinitionVersion) {
	return {
		id: v.id,
		versionNumber: v.versionNumber,
		uploadedAt: v.uploadedAt,
		uploadedBy: v.uploadedBy,
		changeNote: v.changeNote
	};
}

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

// PATCH — update metadata only. New versions POST to `/versions`.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
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
