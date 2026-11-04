import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrganizationProvider, getProjectProvider } from '#lib/server/providers.server.js';

// The acting org's id is on `ctx`, so the counts don't wait for the layout's org read. Each is
// non-fatal: a failed read counts zero.
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');

	const orgId = ctx.actingOrgId;
	if (!orgId) {
		return { memberCount: 0, projectCount: 0 };
	}

	const [memberCount, projectCount] = await Promise.all([
		getOrganizationProvider()
			.listOrgMembers(ctx, orgId, { limit: 1000 })
			.then((page) => page.items.length)
			.catch(() => 0),
		getProjectProvider()
			.listProjects(ctx, orgId, { limit: 200 })
			.then((page) => page.items.length)
			.catch(() => 0)
	]);

	return { memberCount, projectCount };
};
