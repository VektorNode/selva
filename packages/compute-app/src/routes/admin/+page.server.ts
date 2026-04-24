import { getAuthProvider } from '$lib/server/auth.server';
import { hasPermission } from '@selva/platform';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const isPlatformAdmin = locals.ctx ? hasPermission(locals.ctx, 'platform_admin') : false;

	try {
		const usersPage = await getAuthProvider().listUsers({ limit: 200 });

		return {
			stats: {
				users: usersPage?.items.length ?? null
			},
			isPlatformAdmin
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Failed to load admin dashboard:', err);
		return { stats: { users: null }, isPlatformAdmin };
	}
};
