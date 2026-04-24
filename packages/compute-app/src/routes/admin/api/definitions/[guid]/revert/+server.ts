import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { definitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { GuidSchema } from '@selva/platform/definitions/schemas';

const RevertSchema = z.object({
	filename: z
		.string()
		.min(1, 'filename is required')
		.refine(
			(v) => !v.includes('/') && !v.includes('\\') && !v.includes('..'),
			'Invalid filename'
		)
});

// POST - Restore an archived file as the active GH file
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const body = await request.json().catch(() => null);
	const parsed = RevertSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const { record, ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		await definitionService.revertToVersion(ctx, guidParsed.data, parsed.data.filename);
		// revertToVersion preserves fileExt; no re-fetch needed.
		return json({ success: true, filename: `definition.${record.fileExt}` });
	} catch (err) {
		handleApiError(err, 'Failed to revert file');
	}
};
