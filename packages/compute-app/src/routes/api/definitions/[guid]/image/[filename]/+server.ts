import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getStorageProvider, getDefinitionMeta } from '$lib/server/providers.server';
import { requireCanViewProject } from '$lib/server/access.server';
import { GuidSchema } from '@selvajs/platform/definitions/schemas';
import { IMAGE_CONTENT_TYPES } from '$lib/server/admin-config';
import { definitionPaths } from '@selvajs/platform';

// GET /api/definitions/{guid}/image/{filename} — serve a stored cover image
export const GET: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid GUID');

	const guid = guidParsed.data;
	const ctx = locals.ctx!;

	const record = await getDefinitionMeta().get(ctx, guid);
	if (!record?.coverImage) throw error(404, 'Image not found');

	await requireCanViewProject(locals, record.projectId);

	const storedFilename = record.coverImage.split('/').pop() ?? 'cover.webp';
	const ext = storedFilename.substring(storedFilename.lastIndexOf('.')).toLowerCase();
	const contentType = IMAGE_CONTENT_TYPES[ext] ?? 'image/webp';

	const bytes = await getStorageProvider().get(definitionPaths.image(guid));
	if (!bytes) throw error(404, 'Image not found');

	return new Response(Buffer.from(bytes), {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
