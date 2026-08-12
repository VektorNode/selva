import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import { loadVisibleVersion } from '$lib/server/definitions/visibility.server';
import { apiRoute, noContent, parseParam, requireCaller } from '$lib/server/api/v1/route';

/**
 * Version metadata. `schema` is excluded and served by the `/schema`
 * sub-resource, so a version read never carries a several-hundred-KB blob.
 */
export const GET: RequestHandler = apiRoute(
	'Failed to load version',
	async ({ params, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const versionId = parseParam(params.versionId, GuidSchema, 'version ID');
		const { ctx } = requireCaller(locals);

		const version = await loadVisibleVersion(ctx, guid, versionId);
		if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
		const { schema: _schema, ...rest } = version;
		return json(rest);
	}
);

/**
 * Delete an old version. The store throws 409 if the version is currently
 * referenced by `liveVersionId` or `draftVersionId` — repoint first.
 */
export const DELETE: RequestHandler = apiRoute(
	'Failed to delete version',
	async ({ params, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const versionId = parseParam(params.versionId, GuidSchema, 'version ID');

		const { ctx } = await requireEditableDefinition(locals, guid);
		await getDefinitionService().deleteVersion(ctx, guid, versionId);
		return noContent();
	}
);
