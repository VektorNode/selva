import type { LayoutServerLoad } from './$types';

// Auth is handled centrally in hooks.server.ts (guards all /admin/* except /admin/login).
// We expose the current user's permissions here so child pages can gate UI affordances.
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		permissions: locals.user?.permissions ?? []
	};
};
