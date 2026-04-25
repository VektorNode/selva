import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { definitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError } from '$lib/server/api-errors';
import { GuidSchema } from '@selva/platform/definitions/schemas';

/**
 * DELETE /api/definitions/[guid]/versions/[versionId] — delete an old version.
 * Spec §6 protection: the store throws 409 if the version is currently
 * referenced by `liveVersionId` or `draftVersionId`. Repoint first.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');
	const versionParsed = GuidSchema.safeParse(params.versionId);
	if (!versionParsed.success) throw error(400, 'Invalid or missing version ID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		await definitionService.deleteVersion(ctx, guidParsed.data, versionParsed.data);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to delete version');
	}
};
