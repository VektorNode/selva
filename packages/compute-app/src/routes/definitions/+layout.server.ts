import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { hasPermission } from '@selva/platform';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login?redirectTo=/definitions');

	const canManageDefinitions = hasPermission(locals.user.permissions, 'manage_definitions');
	const canManageProjects = hasPermission(locals.user.permissions, 'manage_projects');

	if (!canManageDefinitions && !canManageProjects) {
		redirect(303, '/app');
	}

	return {
		permissions: locals.user.permissions
	};
};
