import type { RequestHandler } from './$types';
import { getUserProfileStore } from '$lib/server/providers.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';

/** Star a definition for the current user. Idempotent. */
export const PUT: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	const guid = params.guid;
	if (!guid) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing definition guid');

	try {
		await getUserProfileStore().starDefinition(locals.ctx, locals.user.id, guid);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to star definition');
	}
};

/** Unstar a definition for the current user. Idempotent. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	const guid = params.guid;
	if (!guid) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing definition guid');

	try {
		await getUserProfileStore().unstarDefinition(locals.ctx, locals.user.id, guid);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to unstar definition');
	}
};
