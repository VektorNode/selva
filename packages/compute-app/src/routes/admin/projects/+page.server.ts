import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';
import { SYSTEM_CONTEXT } from '@selva/platform';
import type { Project, ProjectMember, AuthUser } from '@selva/platform';
import type { PageServerLoad } from './$types';
import { assertManageProjects } from '$lib/server/access.server';

export type { Project, ProjectMember, AuthUser };

export interface ProjectWithMembers extends Project {
	members: ProjectMember[];
}

export const load: PageServerLoad = async ({ locals }) => {
	assertManageProjects(locals);
	const ctx = locals.ctx ?? SYSTEM_CONTEXT;
	try {
		const [orgsPage, usersPage] = await Promise.all([
			getOrganizationProvider().listOrgs(ctx, { limit: 200 }),
			getAuthProvider().listUsers({ limit: 200 })
		]);

		const projectStore = getProjectProvider();
		const projectPages = await Promise.all(
			orgsPage.items.map((org) => projectStore.listProjects(ctx, org.id, { limit: 200 }))
		);
		const allProjects = projectPages.flatMap((p) => p.items);

		const projects: ProjectWithMembers[] = await Promise.all(
			allProjects.map(async (p) => ({
				...p,
				members: (await projectStore.listProjectMembers(ctx, p.id, { limit: 200 })).items
			}))
		);

		return { projects, users: usersPage?.items ?? [] };
	} catch (err) {
		// Let auth errors bubble up; only catch data loading failures
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Failed to load projects page:', err);
		return { projects: [] as ProjectWithMembers[], users: [] as AuthUser[] };
	}
};
