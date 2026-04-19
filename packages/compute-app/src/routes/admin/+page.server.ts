import { getDefinitionMeta, getOrganizationProvider } from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';
import { SYSTEM_CONTEXT } from '@selva/platform';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx ?? SYSTEM_CONTEXT;
	try {
		const [recordsPage, orgsPage, usersPage] = await Promise.all([
			getDefinitionMeta().list(ctx, { limit: 200 }),
			getOrganizationProvider().listOrgs(ctx, { limit: 200 }),
			getAuthProvider().listUsers({ limit: 200 })
		]);

		const projectPages = await Promise.all(
			orgsPage.items.map((org) => getOrganizationProvider().listProjects(ctx, org.id, { limit: 200 }))
		);
		const projects = projectPages.flatMap((p) => p.items);

		return {
			stats: {
				definitions: recordsPage.items.length,
				projects: projects.length,
				users: usersPage?.items.length ?? null
			}
		};
	} catch {
		return { stats: { definitions: 0, projects: 0, users: null } };
	}
};
