import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Project } from '@selvajs/platform';
import { hasPermission } from '@selvajs/platform';
import { getProjectProvider } from '$lib/server/providers.server';

export interface ProjectRow extends Project {
	memberCount: number;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'manage_projects')) redirect(303, '/team');

	const orgId = ctx.actingOrgId;
	if (!orgId) {
		return { projects: [] as ProjectRow[], canCreate: false };
	}

	const projects = getProjectProvider();
	let rows: ProjectRow[] = [];

	try {
		const page = await projects.listProjects(ctx, orgId, { limit: 200 });
		rows = await Promise.all(
			page.items.map(async (project): Promise<ProjectRow> => {
				let memberCount = 0;
				try {
					const members = await projects.listProjectMembers(ctx, project.id, { limit: 200 });
					memberCount = members.items.length;
				} catch {
					// non-fatal
				}
				return { ...project, memberCount };
			})
		);
	} catch {
		// non-fatal — show empty
	}

	return { projects: rows, canCreate: true };
};
