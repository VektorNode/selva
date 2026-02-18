import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionStore } from '$lib/server/definitions.server';
import { GuidSchema } from '$lib/server/definitions/schemas';

const GH_EXTENSIONS = ['.gh', '.ghx'];

// POST - Replace the GH file for an existing definition (upload to GUID folder, archive old)
export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const guid = formData.get('guid') as string | null;

		if (!file || !(file instanceof File)) throw error(400, 'No file provided');

		const guidParsed = GuidSchema.safeParse(guid);
		if (!guidParsed.success) throw error(400, 'Valid definition GUID is required');

		const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
		if (!GH_EXTENSIONS.includes(ext)) {
			throw error(400, `File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
		}

		const filename = await getDefinitionStore().replaceFile(guidParsed.data, {
			name: file.name,
			data: await file.arrayBuffer()
		});

		return json({ success: true, filename, guid: guidParsed.data });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Upload] Failed:', err);
		throw error(500, 'Failed to upload definition file');
	}
};
