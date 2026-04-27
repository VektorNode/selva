import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Organization } from '@selvajs/platform';
import { getOrganizationProvider } from '$lib/server/providers.server';

/**
 * `/team` is the org-scoped admin surface — distinct from `/admin` (platform-
 * scoped). Any authenticated user with an active org can land on the General
 * tab; individual sub-tabs gate themselves on the relevant org permission.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.ctx) redirect(303, '/login');

	const ctx = locals.ctx;
	const orgId = ctx.actingOrgId;
	if (!orgId) return { org: null };

	let org: Organization | null = null;
	try {
		org = await getOrganizationProvider().getOrg(ctx, orgId);
	} catch {
		// non-fatal — chip just won't render
	}
	return { org };
};
