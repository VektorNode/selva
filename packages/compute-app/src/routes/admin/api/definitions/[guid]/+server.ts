import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionFiles, getDefinitionMeta } from '$lib/server/definitions.server';
import { requireCanEdit } from '$lib/server/access.server';
import { GuidSchema, UpdateMetadataInputSchema } from '@selva/platform/definitions/schemas';

async function resolveProjectId(guid: string): Promise<string> {
	const record = await getDefinitionMeta().get(guid);
	if (!record) throw error(404, 'Definition not found');
	return record.projectId;
}

// DELETE - Remove a definition: deletes the entire GUID folder and config entry
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const projectId = await resolveProjectId(guidParsed.data);
	await requireCanEdit(locals, projectId);

	try {
		await getDefinitionMeta().delete(guidParsed.data);
		await getDefinitionFiles().deleteFiles(guidParsed.data);
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Definition DELETE] Failed:', err);
		throw error(500, 'Failed to delete definition');
	}
};

// PUT - Update metadata only (not the file)
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const projectId = await resolveProjectId(guidParsed.data);
	await requireCanEdit(locals, projectId);

	try {
		const body = await request.json();
		const parsed = UpdateMetadataInputSchema.safeParse(body);
		if (!parsed.success) throw error(400, parsed.error.issues[0].message);

		const { maxHistory, projectId: newProjectId, computeServerId, ...metaFields } = parsed.data;
		await getDefinitionMeta().update(guidParsed.data, {
			...(maxHistory !== undefined && { maxHistory }),
			...(newProjectId !== undefined && { projectId: newProjectId }),
			...(computeServerId !== undefined && { computeServerId }),
			meta: metaFields
		});
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Definition PUT] Failed:', err);
		throw error(500, 'Failed to update definition');
	}
};
