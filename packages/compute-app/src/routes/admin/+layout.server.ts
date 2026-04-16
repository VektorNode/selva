import type { LayoutServerLoad } from './$types';

// Auth is handled centrally in hooks.server.ts (guards all /admin/* except /admin/login).
export const load: LayoutServerLoad = async () => {
	return {};
};
