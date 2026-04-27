import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');

	const { org } = await parent();
	if (!org) {
		return { memberCount: 0, projectCount: 0 };
	}

	const orgs = getOrganizationProvider();
	const projects = getProjectProvider();

	let memberCount = 0;
	let projectCount = 0;

	try {
		const members = await orgs.listOrgMembers(ctx, org.id, { limit: 1000 });
		memberCount = members.items.length;
	} catch {
		// non-fatal
	}

	try {
		const page = await projects.listProjects(ctx, org.id, { limit: 200 });
		projectCount = page.items.length;
	} catch {
		// non-fatal
	}

	return { memberCount, projectCount };
};
