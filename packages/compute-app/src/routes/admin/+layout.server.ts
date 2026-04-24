import { redirect } from '@sveltejs/kit';
import { hasPermission } from '@selva/platform';
import type { OrgPermission, PlatformPermission } from '@selva/platform';
import type { LayoutServerLoad } from './$types';

// Auth is handled in hooks.server.ts. Here we enforce that the authenticated
// user holds at least one admin-level permission — otherwise /admin is off-limits
// and they get sent back to the app.
const ADMIN_PERMISSIONS: Array<PlatformPermission | OrgPermission> = [
	'platform_admin',
	'manage_users',
	'manage_compute',
	'manage_definitions',
	'manage_projects'
];

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.ctx) redirect(303, '/login');
	const hasAdminAccess = ADMIN_PERMISSIONS.some((p) => hasPermission(locals.ctx!, p));
	if (!hasAdminAccess) {
		redirect(303, '/app');
	}
	return {
		platformPermissions: locals.ctx.platformPermissions,
		orgPermissions: locals.ctx.orgPermissions
	};
};
