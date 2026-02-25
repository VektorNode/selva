import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionStore } from '$lib/server/definitions.server';
import { GuidSchema } from '$lib/server/definitions/schemas';

// POST - Restore an archived file as the active GH file
export const POST: RequestHandler = async ({ params, request }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const body = await request.json().catch(() => null);
	const filename = body?.filename;
	if (!filename || typeof filename !== 'string') {
		throw error(400, 'filename is required');
	}

	// Prevent path traversal
	if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
		throw error(400, 'Invalid filename');
	}

	try {
		const restoredName = await getDefinitionStore().revertFile(guidParsed.data, filename);
		return json({ success: true, filename: restoredName });
	} catch (err) {
		console.error('[Revert] Failed:', err);
		throw error(500, 'Failed to revert file');
	}
};
