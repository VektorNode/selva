import type { RequestHandler } from './$types';
import { flag, getPlatformProjectGrantStore } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireInstanceAdmin(locals);
	if (!flag('ENABLE_PLATFORM_PROJECTS')) apiError(404, ApiErrorCode.NOT_FOUND, 'Not found');
	const { grantId } = params;
	if (!grantId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing grant ID');
	try {
		await getPlatformProjectGrantStore().delete(SYSTEM_CONTEXT, grantId);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to revoke grant');
	}
};
