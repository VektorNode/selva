import type { RequestHandler } from './$types';
import { flag, getPlatformProjectGrantStore } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, noContent, requireParams } from '$lib/server/api/http';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

export const DELETE: RequestHandler = apiRoute(
	'Failed to revoke grant',
	async ({ params, locals }) => {
		requireInstanceAdmin(locals);
		if (!flag('ENABLE_PLATFORM_PROJECTS')) apiError(404, ApiErrorCode.NOT_FOUND, 'Not found');
		const { grantId } = requireParams(params, 'grantId');

		await getPlatformProjectGrantStore().delete(SYSTEM_CONTEXT, grantId);
		return noContent();
	}
);
