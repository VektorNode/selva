import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import {
	getVisibleDefinition,
	loadVisibleVersion
} from '$lib/server/definitions/visibility.server';

/**
 * Convenience alias for the live version's schema — the call a client makes
 * before solving. The canonical location is
 * `/versions/{versionId}/schema`; this resolves the `live` pointer for you.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');
	if (!locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	try {
		const record = await getVisibleDefinition(locals.ctx, guidParsed.data);
		if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');
		if (!record.liveVersionId)
			apiError(404, ApiErrorCode.NOT_FOUND, 'This definition has no published version');

		const version = await loadVisibleVersion(locals.ctx, guidParsed.data, record.liveVersionId);
		if (!version?.schema)
			apiError(404, ApiErrorCode.NOT_FOUND, 'No schema cached for the live version');
		return json(version.schema);
	} catch (err) {
		handleApiError(err, 'Failed to load definition schema');
	}
};
