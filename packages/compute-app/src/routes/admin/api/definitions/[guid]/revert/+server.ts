import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionFiles, getDefinitionMeta } from '$lib/server/definitions.server';
import { requireCanEdit } from '$lib/server/access.server';
import { GuidSchema } from '@selva/platform/definitions/schemas';

// POST - Restore an archived file as the active GH file
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const body = await request.json().catch(() => null);
	// 'filename' is the archive ref (timestamped filename)
	const ref = body?.filename;
	if (!ref || typeof ref !== 'string') {
		throw error(400, 'filename is required');
	}

	// Prevent path traversal
	if (ref.includes('/') || ref.includes('\\') || ref.includes('..')) {
		throw error(400, 'Invalid filename');
	}

	const guid = guidParsed.data;
	const files = getDefinitionFiles();
	const meta = getDefinitionMeta();

	try {
		// Get the original name from history before removing the entry
		const record = await meta.get(guid);
		if (record) await requireCanEdit(locals, record.projectId);
		const historyEntry = record?.history.find((e) => e.ref === ref);
		const originalName = historyEntry?.originalName ?? ref.replace(/^[^_]+_/, '');

		// Load the archived file bytes
		const archivedBytes = await files.getArchivedFile(guid, ref);
		if (!archivedBytes) throw error(404, 'Archived file not found');

		// Determine extension from the archived filename
		const ext = ref.endsWith('.ghx') ? 'ghx' : 'gh';

		// Archive the current active file (using the reverted file's original name)
		const currentOriginalName = record?.meta.originalFilename ?? `definition.${ext}`;
		const newArchiveEntry = await files.archiveCurrentFile(guid, currentOriginalName);

		// Remove the reverted entry from history and delete its file
		await meta.removeHistoryEntry(guid, ref);
		await files.deleteArchivedFile(guid, ref);

		// Write the restored file as the new active file
		await files.saveFile(guid, archivedBytes, ext);

		// Update meta: new originalFilename + fileExt from the reverted file
		await meta.update(guid, { fileExt: ext, meta: { originalFilename: originalName } });
		if (newArchiveEntry) {
			await meta.addHistoryEntry(guid, newArchiveEntry);

			// Prune if needed
			const updated = await meta.get(guid);
			if (updated && updated.maxHistory > 0 && updated.history.length > updated.maxHistory) {
				const toDelete = updated.history.slice(updated.maxHistory);
				for (const entry of toDelete) {
					await files.deleteArchivedFile(guid, entry.ref);
					await meta.removeHistoryEntry(guid, entry.ref);
				}
			}
		}

		return json({ success: true, filename: `definition.${ext}` });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Revert] Failed:', err);
		throw error(500, 'Failed to revert file');
	}
};
