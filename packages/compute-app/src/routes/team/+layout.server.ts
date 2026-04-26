import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * `/team` is the org-scoped admin surface — distinct from `/admin` (platform-
 * scoped). Any authenticated user with an active org can land on the General
 * tab; individual sub-tabs gate themselves on the relevant org permission.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.ctx) redirect(303, '/login');
	return {};
};
