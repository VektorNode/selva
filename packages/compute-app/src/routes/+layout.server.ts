import type { LayoutServerLoad } from './$types';

// Expose the authenticated user to every route in the app.
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user
			? {
					id: locals.user.id,
					email: locals.user.email,
					displayName: locals.user.displayName,
					permissions: locals.user.permissions,
					starredDefinitions: locals.user.starredDefinitions,
					recentRuns: locals.user.recentRuns
				}
			: null
	};
};
