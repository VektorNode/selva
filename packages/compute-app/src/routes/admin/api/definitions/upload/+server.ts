import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionStore } from '$lib/server/definitions.server';
import { GuidSchema } from '$lib/server/definitions/schemas';
import { GH_EXTENSIONS, MAX_GH_FILE_SIZE } from '$lib/server/admin-config';

// POST - Replace the GH file for an existing definition (upload to GUID folder, archive old)
export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	const guid = formData.get('guid') as string | null;

	if (!file || !(file instanceof File)) throw error(400, 'No file provided');

	const guidParsed = GuidSchema.safeParse(guid);
	if (!guidParsed.success) throw error(400, 'Valid definition GUID is required');

	const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	if (!GH_EXTENSIONS.includes(ext)) {
		throw error(400, `File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
	}

	if (file.size > MAX_GH_FILE_SIZE) {
		throw error(400, `File too large. Max size: ${MAX_GH_FILE_SIZE / (1024 * 1024)} MB`);
	}

	try {
		const filename = await getDefinitionStore().replaceFile(guidParsed.data, {
			name: file.name,
			data: await file.arrayBuffer()
		});
		return json({ success: true, filename, guid: guidParsed.data });
	} catch (err) {
		console.error('[Upload] Failed:', err);
		throw error(500, 'Failed to upload definition file');
	}
};
