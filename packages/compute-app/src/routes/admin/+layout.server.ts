import { redirect } from '@sveltejs/kit';
import { hasPermission } from '@selva/platform';
import type { Permission } from '@selva/platform';
import type { LayoutServerLoad } from './$types';

// Auth is handled in hooks.server.ts. Here we enforce that the authenticated
// user holds at least one admin permission — otherwise /admin is off-limits
// and they get sent back to the app.
const ADMIN_PERMISSIONS: Permission[] = [
	'platform_admin',
	'manage_users',
	'manage_compute',
	'manage_definitions',
	'manage_projects'
];

export const load: LayoutServerLoad = async ({ locals }) => {
	const permissions = locals.user?.permissions ?? [];
	const hasAdminAccess = ADMIN_PERMISSIONS.some((p) => hasPermission(permissions, p));
	if (!hasAdminAccess) {
		redirect(303, '/app');
	}
	return { permissions };
};
