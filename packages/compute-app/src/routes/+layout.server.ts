import type { LayoutServerLoad } from './$types';

// Expose the authenticated user to every route in the app.
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user
			? {
					id: locals.user.id,
					email: locals.user.email,
					platformPermissions: locals.user.platformPermissions
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
					orgId: locals.ctx.orgId,
					platformPermissions: locals.ctx.platformPermissions,
					orgPermissions: locals.ctx.orgPermissions
				}
			: null
	};
};
