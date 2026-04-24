import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { definitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { GuidSchema, UpdateMetadataInputSchema } from '@selva/platform/definitions/schemas';

// DELETE — remove a definition and all its files
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		await definitionService.delete(ctx, guidParsed.data);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to delete definition');
	}
};

// PUT — update metadata only
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	const body = await request.json().catch(() => null);
	const parsed = UpdateMetadataInputSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		await definitionService.updateMeta(ctx, guidParsed.data, parsed.data);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to update definition');
	}
};
