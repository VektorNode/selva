import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';

/**
 * Whoami. The first call a non-browser client makes, and the only way a token
 * holder can see which org their credential resolved into — `actingOrgId` is
 * derived per request from the caller's membership, not frozen at mint time.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.ctx || !locals.user) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	return json({
		userId: locals.user.id,
		email: locals.user.email,
		displayName: locals.profile?.displayName,
		actingOrgId: locals.ctx.actingOrgId,
		platformPermissions: locals.ctx.platformPermissions,
		orgPermissions: locals.ctx.orgPermissions,
		starredDefinitions: locals.profile?.starredDefinitions ?? []
	});
};
