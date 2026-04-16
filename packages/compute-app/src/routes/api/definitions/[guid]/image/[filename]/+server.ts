import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionFiles, getDefinitionMeta } from '$lib/server/definitions.server';
import { GuidSchema } from '@selva/platform/definitions/schemas';
import { IMAGE_CONTENT_TYPES } from '$lib/server/admin-config';

// GET /api/definitions/{guid}/image/{filename} — public endpoint to serve cover images
export const GET: RequestHandler = async ({ params }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid GUID');

	const guid = guidParsed.data;

	// Get the stored coverImage filename from meta to determine content-type
	const record = await getDefinitionMeta().get(guid);
	if (!record?.meta.coverImage) throw error(404, 'Image not found');

	const storedFilename = record.meta.coverImage.split('/').pop() ?? 'cover.webp';
	const ext = storedFilename.substring(storedFilename.lastIndexOf('.')).toLowerCase();
	const contentType = IMAGE_CONTENT_TYPES[ext] ?? 'image/webp';

	const bytes = await getDefinitionFiles().getPreviewImage(guid);
	if (!bytes) throw error(404, 'Image not found');

	return new Response(Buffer.from(bytes), {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
