import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import { loadVisibleVersion } from '$lib/server/definitions/visibility.server';

// GET — version metadata. `schema` is excluded; it is served by the `/schema`
// sub-resource so a version read never carries a several-hundred-KB blob.
export const GET: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');
	const versionParsed = GuidSchema.safeParse(params.versionId);
	if (!versionParsed.success)
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing version ID');
	if (!locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	try {
		const version = await loadVisibleVersion(locals.ctx, guidParsed.data, versionParsed.data);
		if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
		const { schema: _schema, ...rest } = version;
		return json(rest);
	} catch (err) {
		handleApiError(err, 'Failed to load version');
	}
};

/**
 * DELETE /api/definitions/[guid]/versions/[versionId] — delete an old version.
 * Spec §6 protection: the store throws 409 if the version is currently
 * referenced by `liveVersionId` or `draftVersionId`. Repoint first.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');
	const versionParsed = GuidSchema.safeParse(params.versionId);
	if (!versionParsed.success)
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing version ID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		await getDefinitionService().deleteVersion(ctx, guidParsed.data, versionParsed.data);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to delete version');
	}
};
