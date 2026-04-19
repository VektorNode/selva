import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { definitionService, getDefinitionMeta } from '$lib/server/providers.server';
import { requireCanEdit } from '$lib/server/access.server';
import { GuidSchema } from '@selva/platform/definitions/schemas';
import { GH_EXTENSIONS, MAX_GH_FILE_SIZE } from '$lib/server/admin-config';

// POST - Replace the GH file for an existing definition (archive old, save new)
export const POST: RequestHandler = async ({ request, locals }) => {
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

	const fileExt = ext.slice(1) as 'gh' | 'ghx';
	const resolvedGuid = guidParsed.data;
	const ctx = locals.ctx!;

	try {
		const record = await getDefinitionMeta().get(ctx, resolvedGuid);
		if (record) await requireCanEdit(locals, record.projectId);

		const fileData = new Uint8Array(await file.arrayBuffer());
		await definitionService.updateFile(ctx, resolvedGuid, fileData, fileExt, file.name);

		return json({ success: true, filename: `definition.${fileExt}`, guid: resolvedGuid });
	} catch (err) {
		console.error('[Upload] Failed:', err);
		throw error(500, 'Failed to upload definition file');
	}
};
