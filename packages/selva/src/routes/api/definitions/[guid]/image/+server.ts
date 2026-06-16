import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import { MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';

// POST /api/definitions/{guid}/image — upload a cover image
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid GUID');

	const guid = guidParsed.data;
	const { ctx } = await requireEditableDefinition(locals, guid);

	const formData = await request.formData();
	const file = formData.get('image');
	if (!(file instanceof File) || file.size === 0) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Image file is required');
	}
	if (file.size > MAX_IMAGE_FILE_SIZE) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`
		);
	}

	try {
		const imageData = new Uint8Array(await file.arrayBuffer());
		const coverImage = await getDefinitionService().saveCoverImage(ctx, guid, imageData);
		return json({ coverImage });
	} catch (err) {
		handleApiError(err, 'Failed to upload image');
	}
};
