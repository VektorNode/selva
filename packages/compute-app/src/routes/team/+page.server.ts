import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Organization } from '@selvajs/platform';
import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');

	const orgId = ctx.actingOrgId;
	if (!orgId) {
		return {
			org: null,
			memberCount: 0,
			projectCount: 0
		};
	}

	const orgs = getOrganizationProvider();
	const projects = getProjectProvider();

	let org: Organization | null = null;
	let memberCount = 0;
	let projectCount = 0;

	try {
		org = await orgs.getOrg(ctx, orgId);
	} catch {
		// non-fatal
	}

	try {
		const members = await orgs.listOrgMembers(ctx, orgId, { limit: 1000 });
		memberCount = members.items.length;
	} catch {
		// non-fatal
	}

	try {
		const page = await projects.listProjects(ctx, orgId, { limit: 200 });
		projectCount = page.items.length;
	} catch {
		// non-fatal
	}

	return { org, memberCount, projectCount };
};
