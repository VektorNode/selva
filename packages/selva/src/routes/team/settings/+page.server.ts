import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Organization, OrgMember } from '@selvajs/platform';
import { hasPermission } from '@selvajs/platform';
import { getOrganizationProvider } from '$lib/server/providers.server';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'manage_org_members')) redirect(303, '/team');

	const orgId = ctx.actingOrgId;
	if (!orgId) return { org: null as Organization | null, isOwner: false };

	const orgs = getOrganizationProvider();

	let org: Organization | null = null;
	let member: OrgMember | null = null;
	try {
		org = await orgs.getOrg(ctx, orgId);
		member = await orgs.getOrgMember(ctx, orgId, ctx.userId);
	} catch {
		// non-fatal
	}

	// Authority is the membership row, never `org.ownerId` — that column records
	// who created the org and can disagree with the roster. Same rule as
	// `canChangeOrgRole`.
	return { org, isOwner: member?.role === 'owner' };
};
