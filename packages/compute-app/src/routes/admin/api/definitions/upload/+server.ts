import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionFiles, getDefinitionMeta } from '$lib/server/definitions.server';
import { GuidSchema } from '@selva/platform/definitions/schemas';
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

	const fileExt = ext.slice(1) as 'gh' | 'ghx';
	const resolvedGuid = guidParsed.data;
	const files = getDefinitionFiles();
	const meta = getDefinitionMeta();

	try {
		// Get current originalFilename for the archive entry label
		const record = await meta.get(resolvedGuid);
		const originalName = record?.meta.originalFilename ?? file.name;

		// Archive the current active file
		const archivedEntry = await files.archiveCurrentFile(resolvedGuid, originalName);

		// Save the new file
		const fileData = new Uint8Array(await file.arrayBuffer());
		await files.saveFile(resolvedGuid, fileData, fileExt);

		// Update meta: new originalFilename + fileExt (may differ from previous upload)
		await meta.update(resolvedGuid, { fileExt, meta: { originalFilename: file.name } });
		if (archivedEntry) {
			await meta.addHistoryEntry(resolvedGuid, archivedEntry);

			// Prune excess archived files if maxHistory is set
			const updated = await meta.get(resolvedGuid);
			if (updated && updated.maxHistory > 0 && updated.history.length > updated.maxHistory) {
				const toDelete = updated.history.slice(updated.maxHistory);
				for (const entry of toDelete) {
					await files.deleteArchivedFile(resolvedGuid, entry.ref);
					await meta.removeHistoryEntry(resolvedGuid, entry.ref);
				}
			}
		}

		return json({ success: true, filename: `definition.${fileExt}`, guid: resolvedGuid });
	} catch (err) {
		console.error('[Upload] Failed:', err);
		throw error(500, 'Failed to upload definition file');
	}
};
