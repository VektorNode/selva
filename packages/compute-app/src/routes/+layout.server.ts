import type { LayoutServerLoad } from './$types';

// Expose the authenticated user to every route in the app.
// hooks.server.ts populates locals.user for authenticated routes;
// unauthenticated routes get null here.
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user
			? {
					id: locals.user.id,
					email: locals.user.email,
					displayName: locals.user.displayName,
					permissions: locals.user.permissions
				}
			: null
	};
};
