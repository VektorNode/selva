import { getDefinitionMeta } from '$lib/server/definitions.server';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const [records, orgList, users] = await Promise.all([
			getDefinitionMeta().list(),
			getOrganizationProvider().listOrgs(),
			getAuthProvider().listUsers()
		]);

		const projects = (
			await Promise.all(orgList.map((org) => getOrganizationProvider().listProjects(org.id)))
		).flat();

		return {
			stats: {
				definitions: records.length,
				projects: projects.length,
				users: users?.length ?? null
			}
		};
	} catch {
		return { stats: { definitions: 0, projects: 0, users: null } };
	}
};
