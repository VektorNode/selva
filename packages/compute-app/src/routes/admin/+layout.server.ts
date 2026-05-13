import { redirect } from '@sveltejs/kit';
import { assertAnyPlatformPermission } from '$lib/server/access.server';
import { getAuditQuery } from '$lib/server/providers.server';
import type { LayoutServerLoad } from './$types';

/**
 * `/admin` is a platform-scope surface — instance operators and Selva staff
 * only. Holding only org-class permissions (`manage_org_members`,
 * `manage_org_compute`, `manage_definitions`, `manage_projects`) does NOT
 * admit you here, even though those permissions also start with `manage_`.
 * Org admins get their own surface elsewhere — `/team/*` (see Permissions.md §8).
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.ctx) redirect(303, '/login');
	assertAnyPlatformPermission(locals);
	return {
		platformPermissions: locals.ctx.platformPermissions,
		orgPermissions: locals.ctx.orgPermissions,
		auditAvailable: getAuditQuery() !== null
	};
};
