import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionStore } from '$lib/server/definitions.server';
import { GuidSchema } from '$lib/server/definitions/schemas';
import { IMAGE_CONTENT_TYPES } from '$lib/server/admin-config';

// GET /api/definitions/{guid}/image/{filename} — public endpoint to serve cover images
export const GET: RequestHandler = async ({ params }) => {
	const { filename } = params;

	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid GUID');

	if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
	const contentType = IMAGE_CONTENT_TYPES[ext];
	if (!contentType) throw error(400, 'Unsupported image type');

	const store = getDefinitionStore();

	// Try requested filename first, then fall back to .webp variant (post-compression migration)
	const webpFilename = filename.replace(/\.[^.]+$/, '.webp');
	const candidates = filename === webpFilename ? [filename] : [filename, webpFilename];

	for (const candidate of candidates) {
		try {
			const candidateExt = candidate.substring(candidate.lastIndexOf('.')).toLowerCase();
			const candidateContentType = IMAGE_CONTENT_TYPES[candidateExt] ?? contentType;
			const buffer = await store.readImage(guidParsed.data, candidate);
			return new Response(new Uint8Array(buffer), {
				headers: {
					'Content-Type': candidateContentType,
					'Cache-Control': 'public, max-age=3600'
				}
			});
		} catch {
			// try next candidate
		}
	}

	throw error(404, 'Image not found');
};
