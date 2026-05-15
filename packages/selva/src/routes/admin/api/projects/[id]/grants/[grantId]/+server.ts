import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { flag, getPlatformProjectGrantStore } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { handleApiError } from '$lib/server/api-errors';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireInstanceAdmin(locals);
	if (!flag('ENABLE_PLATFORM_PROJECTS')) throw error(404, 'Not found');
	const { grantId } = params;
	if (!grantId) throw error(400, 'Missing grant ID');
	try {
		await getPlatformProjectGrantStore().delete(SYSTEM_CONTEXT, grantId);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to revoke grant');
	}
};
