import { getOrganizationProvider } from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';
import type { Project, ProjectMember } from '@selva/platform/organizations';
import type { AuthUser } from '@selva/platform/auth';
import type { PageServerLoad } from './$types';

export type { Project, ProjectMember, AuthUser };

export interface ProjectWithMembers extends Project {
	members: ProjectMember[];
}

export const load: PageServerLoad = async () => {
	try {
		const orgs = getOrganizationProvider();
		const [orgList, users] = await Promise.all([orgs.listOrgs(), getAuthProvider().listUsers()]);

		const allProjects = (await Promise.all(orgList.map((org) => orgs.listProjects(org.id)))).flat();

		const projects: ProjectWithMembers[] = await Promise.all(
			allProjects.map(async (p) => ({
				...p,
				members: await orgs.listProjectMembers(p.id)
			}))
		);

		return { projects, users: users ?? [] };
	} catch (err) {
		console.error('Failed to load projects page:', err);
		return { projects: [] as ProjectWithMembers[], users: [] as AuthUser[] };
	}
};
