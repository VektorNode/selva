import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiRoute, requireCaller } from '$lib/server/api/v1/route';

/**
 * Whoami. The first call a non-browser client makes, and the only way a token
 * holder can see which org their credential resolved into — `actingOrgId` is
 * derived per request from the caller's membership, not frozen at mint time.
 */
export const GET: RequestHandler = apiRoute('Failed to load identity', async ({ locals }) => {
	const { ctx, user } = requireCaller(locals);

	return json({
		userId: user.id,
		email: user.email,
		displayName: locals.profile?.displayName,
		actingOrgId: ctx.actingOrgId,
		platformPermissions: ctx.platformPermissions,
		orgPermissions: ctx.orgPermissions,
		starredDefinitions: locals.profile?.starredDefinitions ?? []
	});
});
