import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import { loadVisibleVersion } from '$lib/server/definitions/visibility.server';
import { apiRoute, parseParam, requireCaller } from '$lib/server/api/v1/route';

/**
 * The UI schema cached on this version at upload. Reads what is stored — no
 * Rhino.Compute round-trip, unlike the pre-upload `POST /api/v1/compute/schema`.
 *
 * Schemas belong to a version, so this is the canonical location;
 * `/definitions/{guid}/schema` is an alias for the live one.
 */
export const GET: RequestHandler = apiRoute(
	'Failed to load version schema',
	async ({ params, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const versionId = parseParam(params.versionId, GuidSchema, 'version ID');
		const { ctx } = requireCaller(locals);

		const version = await loadVisibleVersion(ctx, guid, versionId);
		if (!version) apiError(404, ApiErrorCode.NOT_FOUND, 'Version not found');
		// A pre-caching version can still lack a schema (lazy backfill bridge) —
		// that is a missing sub-resource, not an error.
		if (!version.schema) apiError(404, ApiErrorCode.NOT_FOUND, 'No schema cached for this version');
		return json(version.schema);
	}
);
