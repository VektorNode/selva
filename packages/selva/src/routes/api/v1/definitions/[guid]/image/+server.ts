import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { GuidSchema } from '@selvajs/platform/definitions';
import { MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';
import { apiRoute, parseParam, requireUpload } from '$lib/server/api/v1/route';

/** Upload a cover image. */
export const POST: RequestHandler = apiRoute(
	'Failed to upload image',
	async ({ params, request, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { ctx } = await requireEditableDefinition(locals, guid);

		const { file } = requireUpload(await request.formData(), 'image', {
			maxBytes: MAX_IMAGE_FILE_SIZE,
			label: 'Image'
		});

		const data = new Uint8Array(await file.arrayBuffer());
		return json({ coverImage: await getDefinitionService().saveCoverImage(ctx, guid, data) });
	}
);
