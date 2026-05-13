import { flag } from '$lib/server/providers.server';
import type { LayoutServerLoad } from './$types';

// Expose the authenticated user to every route in the app.
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user
			? {
					id: locals.user.id,
					email: locals.user.email,
					// Platform permissions live on `ctx`, not on the AuthUser identity.
					platformPermissions: locals.ctx?.platformPermissions ?? []
				}
			: null,
		profile: locals.profile
			? {
					userId: locals.profile.userId,
					displayName: locals.profile.displayName,
					starredDefinitions: locals.profile.starredDefinitions,
					recentRuns: locals.profile.recentRuns
				}
			: null,
		ctx: locals.ctx
			? {
					orgId: locals.ctx.actingOrgId,
					platformPermissions: locals.ctx.platformPermissions,
					orgPermissions: locals.ctx.orgPermissions
				}
			: null,
		flags: {
			enableSharing: flag('ENABLE_SHARING')
		}
	};
};
