import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Organization } from '@selvajs/platform';
import { hasPermission } from '@selvajs/platform';
import { getOrganizationProvider } from '$lib/server/providers.server';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'manage_org_members')) redirect(303, '/team');

	const orgId = ctx.actingOrgId;
	if (!orgId) return { org: null as Organization | null, isOwner: false };

	let org: Organization | null = null;
	try {
		org = await getOrganizationProvider().getOrg(ctx, orgId);
	} catch {
		// non-fatal
	}

	const isOwner = !!org && org.ownerId === ctx.userId;
	return { org, isOwner };
};
