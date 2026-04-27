import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Project } from '@selvajs/platform';
import { hasPermission, SYSTEM_CONTEXT } from '@selvajs/platform';
import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';

export interface ReclaimRow extends Project {
	orgName: string;
	orgSlug: string;
	memberCount: number;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'instance_admin')) redirect(303, '/admin');

	const orgs = getOrganizationProvider();
	const projectStore = getProjectProvider();

	let rows: ReclaimRow[] = [];
	try {
		const orgPage = await orgs.listOrgs(SYSTEM_CONTEXT, { limit: 200 });
		const perOrg = await Promise.all(
			orgPage.items.map(async (org) => {
				try {
					const projects = await projectStore.listProjects(SYSTEM_CONTEXT, org.id, {
						limit: 200
					});
					return await Promise.all(
						projects.items.map(async (project): Promise<ReclaimRow> => {
							let memberCount = 0;
							try {
								const members = await projectStore.listProjectMembers(SYSTEM_CONTEXT, project.id, {
									limit: 200
								});
								memberCount = members.items.length;
							} catch {
								// non-fatal
							}
							return {
								...project,
								orgName: org.name,
								orgSlug: org.slug,
								memberCount
							};
						})
					);
				} catch {
					return [] as ReclaimRow[];
				}
			})
		);
		rows = perOrg.flat();
	} catch {
		// listOrgs unavailable — show empty
	}

	return { projects: rows };
};
