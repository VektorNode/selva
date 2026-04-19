import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { definitionService, getDefinitionMeta } from '$lib/server/providers.server';
import { requireCanEdit } from '$lib/server/access.server';
import { GuidSchema } from '@selva/platform/definitions/schemas';

// POST - Restore an archived file as the active GH file
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const body = await request.json().catch(() => null);
	const ref = body?.filename;
	if (!ref || typeof ref !== 'string') {
		throw error(400, 'filename is required');
	}

	if (ref.includes('/') || ref.includes('\\') || ref.includes('..')) {
		throw error(400, 'Invalid filename');
	}

	const guid = guidParsed.data;
	const ctx = locals.ctx!;

	try {
		const record = await getDefinitionMeta().get(ctx, guid);
		if (record) await requireCanEdit(locals, record.projectId);

		await definitionService.revertToVersion(ctx, guid, ref);

		const updated = await getDefinitionMeta().get(ctx, guid);
		return json({ success: true, filename: `definition.${updated?.fileExt ?? 'gh'}` });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Revert] Failed:', err);
		throw error(500, 'Failed to revert file');
	}
};
