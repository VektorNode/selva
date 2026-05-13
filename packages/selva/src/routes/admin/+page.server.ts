import { getAuthProvider } from '$lib/server/auth.server';
import { hasPermission, type PlatformPermission } from '@selvajs/platform';
import type { PageServerLoad } from './$types';

/**
 * The General dashboard sits inside the platform-scoped `/admin` shell, but
 * each panel still needs its own permission. The user-count tile is gated
 * on `manage_instance_users`; without it, the tile renders a placeholder.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	const canSeeUserStats = ctx ? hasPermission(ctx, 'manage_instance_users') : false;

	const platformPermissions: PlatformPermission[] = ctx?.platformPermissions ?? [];

	if (!canSeeUserStats) {
		return { stats: { users: null }, platformPermissions };
	}

	try {
		const usersPage = await getAuthProvider().listUsers({ limit: 200 });
		return {
			stats: { users: usersPage?.items.length ?? null },
			platformPermissions
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Failed to load admin dashboard:', err);
		return { stats: { users: null }, platformPermissions };
	}
};
