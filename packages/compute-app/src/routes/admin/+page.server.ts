import { getAuthProvider } from '$lib/server/auth.server';
import { hasPermission } from '@selvajs/platform';
import type { PageServerLoad } from './$types';

/**
 * The General dashboard sits inside the platform-scoped `/admin` shell, but
 * its individual panels each require their own permission. Surfacing the
 * instance-wide user count to a `manage_compute`-only operator would leak
 * tenancy data they have no business seeing — `manage_instance_users` is
 * the right gate for the user-count panel.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	const isPlatformAdmin = ctx ? hasPermission(ctx, 'instance_admin') : false;
	const canSeeUserStats = ctx ? hasPermission(ctx, 'manage_instance_users') : false;

	if (!canSeeUserStats) {
		return { stats: { users: null }, isPlatformAdmin };
	}

	try {
		const usersPage = await getAuthProvider().listUsers({ limit: 200 });
		return {
			stats: { users: usersPage?.items.length ?? null },
			isPlatformAdmin
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Failed to load admin dashboard:', err);
		return { stats: { users: null }, isPlatformAdmin };
	}
};
