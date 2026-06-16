import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getStorageProvider, getDefinitionMeta } from '$lib/server/providers.server';
import { requireCanViewProject } from '$lib/server/access.server';
import { GuidSchema, definitionPaths } from '@selvajs/platform/definitions';
import { IMAGE_CONTENT_TYPES } from '$lib/server/admin-config';

// GET /api/definitions/{guid}/image/{filename} — serve a stored cover image
export const GET: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid GUID');

	const guid = guidParsed.data;
	const ctx = locals.ctx!;

	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record?.coverImage) apiError(404, ApiErrorCode.NOT_FOUND, 'Image not found');

	await requireCanViewProject(locals, record.projectId);

	const storedFilename = record.coverImage.split('/').pop() ?? 'cover.webp';
	const ext = storedFilename.substring(storedFilename.lastIndexOf('.')).toLowerCase();
	const contentType = IMAGE_CONTENT_TYPES[ext] ?? 'image/webp';

	const bytes = await getStorageProvider().get(definitionPaths.image(guid));
	if (!bytes) apiError(404, ApiErrorCode.NOT_FOUND, 'Image not found');

	return new Response(Buffer.from(bytes), {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
