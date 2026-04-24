import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { definitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError } from '$lib/server/api-errors';
import { GuidSchema } from '@selva/platform/definitions/schemas';
import { MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';

// POST /admin/api/definitions/{guid}/image — upload a cover image
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid GUID');

	const guid = guidParsed.data;
	const { ctx } = await requireEditableDefinition(locals, guid);

	const formData = await request.formData();
	const file = formData.get('image');
	if (!(file instanceof File) || file.size === 0) {
		throw error(400, 'Image file is required');
	}
	if (file.size > MAX_IMAGE_FILE_SIZE) {
		throw error(400, `Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`);
	}

	try {
		const imageData = new Uint8Array(await file.arrayBuffer());
		const coverImage = await definitionService.saveCoverImage(ctx, guid, imageData);
		return json({ success: true, coverImage });
	} catch (err) {
		handleApiError(err, 'Failed to upload image');
	}
};
