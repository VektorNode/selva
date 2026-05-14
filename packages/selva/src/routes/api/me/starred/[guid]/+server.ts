import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getUserProfileStore } from '$lib/server/providers.server';
import { handleApiError } from '$lib/server/api-errors';

/** Star a definition for the current user. No-op if already starred. */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.ctx) throw error(401, 'Unauthorized');
	const guid = params.guid;
	if (!guid) throw error(400, 'Missing definition guid');

	try {
		await getUserProfileStore().starDefinition(locals.ctx, locals.user.id, guid);
		return json({ starred: true });
	} catch (err) {
		handleApiError(err, 'Failed to star definition');
	}
};

/** Unstar a definition for the current user. No-op if not starred. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.ctx) throw error(401, 'Unauthorized');
	const guid = params.guid;
	if (!guid) throw error(400, 'Missing definition guid');

	try {
		await getUserProfileStore().unstarDefinition(locals.ctx, locals.user.id, guid);
		return json({ starred: false });
	} catch (err) {
		handleApiError(err, 'Failed to unstar definition');
	}
};
