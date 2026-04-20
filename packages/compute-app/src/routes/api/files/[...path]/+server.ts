import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getStorageProvider } from '$lib/server/providers.server';

// Generic file-serving endpoint for publicly accessible files in storage (e.g. definition cover images).

const ALLOWED_EXTENSIONS: Record<string, string> = {
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf'
};

export const GET: RequestHandler = async ({ params }) => {
	const storagePath = params.path;
	if (!storagePath) throw error(400, 'Missing path');

	const ext = storagePath.substring(storagePath.lastIndexOf('.')).toLowerCase();
	if (!ALLOWED_EXTENSIONS[ext]) throw error(403, 'File type not publicly accessible');

	const bytes = await getStorageProvider().get(storagePath);
	if (!bytes) throw error(404, 'File not found');

	return new Response(Buffer.from(bytes), {
		headers: {
			'Content-Type': ALLOWED_EXTENSIONS[ext],
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
