import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { definitionService, getDefinitionMeta } from '$lib/server/providers.server';
import { requireCanEdit } from '$lib/server/access.server';
import { GuidSchema } from '@selva/platform/definitions/schemas';
import { MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';

// POST /admin/api/definitions/{guid}/image — upload a cover image
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid GUID');

	try {
		const formData = await request.formData();
		const file = formData.get('image');

		if (!file || !(file instanceof File) || file.size === 0) {
			throw error(400, 'Image file is required');
		}

		if (file.size > MAX_IMAGE_FILE_SIZE) {
			throw error(400, `Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`);
		}

		const guid = guidParsed.data;
		const ctx = locals.ctx!;
		const record = await getDefinitionMeta().get(ctx, guid);
		if (record) await requireCanEdit(locals, record.projectId);

		const imageData = new Uint8Array(await file.arrayBuffer());
		await definitionService.saveCoverImage(ctx, guid, imageData);

		const updated = await getDefinitionMeta().get(ctx, guid);
		return json({ success: true, coverImage: updated?.coverImage ?? null });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Image POST] Failed:', err);
		throw error(500, 'Failed to upload image');
	}
};
