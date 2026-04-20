import type { LayoutServerLoad } from './$types';

// Auth is handled centrally in hooks.server.ts (guards all /admin/* except /admin/login).
// user is inherited from the root layout; we only add permissions as a convenience alias
// so child pages can call can('manage_users') etc. without reading the full user object.
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		permissions: locals.user?.permissions ?? []
	};
};
