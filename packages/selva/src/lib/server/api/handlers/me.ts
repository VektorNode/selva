/**
 * Whoami. The first call a non-browser client makes, and the only way a token
 * holder can see which org their credential resolved into — `actingOrgId` is
 * derived per request from the caller's membership, not frozen at mint time.
 */

import type { ApiHandler } from '@selvajs/server/api';
import { requireCaller } from '../callers';

export const getMe: ApiHandler = async (req) => {
	const { ctx, user } = requireCaller(req);

	return {
		body: {
			userId: user.id,
			email: user.email,
			displayName: req.profile?.displayName,
			actingOrgId: ctx.actingOrgId,
			platformPermissions: ctx.platformPermissions,
			orgPermissions: ctx.orgPermissions,
			starredDefinitions: req.profile?.starredDefinitions ?? []
		}
	};
};
