import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { hasPermission, type PlatformPermission } from '@selvajs/platform';
import pkg from '../../../package.json';
import type { PageServerLoad } from './$types';

/** Minimal org shape the asset cards need — id to target uploads, current asset URLs to preview. */
interface AdminOrg {
	id: string;
	name: string;
	assets: Record<string, string>;
}

/**
 * Resolve the org whose branding assets the General page manages. Single-tenant
 * has exactly one org (auto-seeded at bootstrap); we surface it so an admin can
 * set the company logo without the org-list UI (which only exists in
 * multi-tenant). Returns null if no org exists yet or the lookup fails — the
 * cards just hide.
 */
async function loadAdminOrg(ctx: App.Locals['ctx']): Promise<AdminOrg | null> {
	if (!ctx) return null;
	try {
		const page = await getOrganizationProvider().listOrgs(ctx, { limit: 1 });
		const org = page.items[0];
		return org ? { id: org.id, name: org.name, assets: org.assets ?? {} } : null;
	} catch (err) {
		console.error('Failed to load admin org for asset cards:', err);
		return null;
	}
}

/**
 * The General dashboard sits inside the platform-scoped `/admin` shell, but
 * each panel still needs its own permission. The user-count tile is gated
 * on `manage_instance_users`; without it, the tile renders a placeholder.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	const canSeeUserStats = ctx ? hasPermission(ctx, 'manage_instance_users') : false;
	const canManageOrg = ctx ? hasPermission(ctx, 'manage_org_members') : false;

	const platformPermissions: PlatformPermission[] = ctx?.platformPermissions ?? [];

	// Branding-asset management is an org-admin action — only resolve the org for
	// users who can manage it. The upload routes enforce the same permission.
	const org = canManageOrg ? await loadAdminOrg(ctx) : null;

	if (!canSeeUserStats) {
		return { stats: { users: null }, platformPermissions, version: pkg.version, org };
	}

	try {
		const usersPage = await getAuthProvider().listUsers({ limit: 200 });
		return {
			stats: { users: usersPage?.items.length ?? null },
			platformPermissions,
			version: pkg.version,
			org
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Failed to load admin dashboard:', err);
		return { stats: { users: null }, platformPermissions, version: pkg.version, org };
	}
};
