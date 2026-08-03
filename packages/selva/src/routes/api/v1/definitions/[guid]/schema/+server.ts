import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import {
	getVisibleDefinition,
	loadVisibleVersion
} from '$lib/server/definitions/visibility.server';
import { apiRoute, parseParam, requireCaller } from '$lib/server/api/v1/route';

/**
 * Convenience alias for the live version's schema — the call a client makes
 * before solving. The canonical location is `/versions/{versionId}/schema`;
 * this resolves the `live` pointer for you.
 */
export const GET: RequestHandler = apiRoute(
	'Failed to load definition schema',
	async ({ params, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { ctx } = requireCaller(locals);

		const record = await getVisibleDefinition(ctx, guid);
		if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');
		if (!record.liveVersionId) {
			apiError(404, ApiErrorCode.NOT_FOUND, 'This definition has no published version');
		}

		const version = await loadVisibleVersion(ctx, guid, record.liveVersionId);
		if (!version?.schema) {
			apiError(404, ApiErrorCode.NOT_FOUND, 'No schema cached for the live version');
		}
		return json(version.schema);
	}
);
