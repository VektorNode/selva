import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { hasPermission } from '@selvajs/platform';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.ctx) redirect(303, '/login?redirectTo=/projects');

	const canManageDefinitions = hasPermission(locals.ctx, 'manage_definitions');
	const canManageProjects = hasPermission(locals.ctx, 'manage_projects');

	if (!canManageDefinitions && !canManageProjects) {
		redirect(303, '/library');
	}

	return {
		platformPermissions: locals.ctx.platformPermissions,
		orgPermissions: locals.ctx.orgPermissions
	};
};
