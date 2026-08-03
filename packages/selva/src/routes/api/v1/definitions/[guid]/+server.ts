import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema, UpdateMetadataInputSchema } from '@selvajs/platform/definitions';

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
