import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import { loadVisibleVersion } from '$lib/server/definitions/visibility.server';

/**
 * The UI schema cached on this version at upload. Reads what is stored — no
 * Rhino.Compute round-trip, unlike the pre-upload `POST /api/v1/compute/schema`.
 *
 * Schemas belong to a version, so this is the canonical location;
 * `/definitions/{guid}/schema` is an alias for the live one.
 */
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
		// Pre-caching versions can still lack a schema (lazy backfill bridge, see
		// specs/SchemaCaching.md); that is a missing sub-resource, not an error.
		if (!version.schema) apiError(404, ApiErrorCode.NOT_FOUND, 'No schema cached for this version');
		return json(version.schema);
	} catch (err) {
		handleApiError(err, 'Failed to load version schema');
	}
};
