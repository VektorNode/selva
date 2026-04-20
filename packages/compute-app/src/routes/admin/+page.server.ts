import { getDefinitionMeta, getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';
import { SYSTEM_CONTEXT, hasPermission } from '@selva/platform';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx ?? SYSTEM_CONTEXT;
	const isPlatformAdmin = locals.user ? hasPermission(locals.user.permissions, 'platform_admin') : false;

	try {
		const [recordsPage, orgsPage, usersPage] = await Promise.all([
			getDefinitionMeta().list(ctx, { limit: 200 }),
			getOrganizationProvider().listOrgs(ctx, { limit: 200 }),
			getAuthProvider().listUsers({ limit: 200 })
		]);

		const projectPages = await Promise.all(
			orgsPage.items.map((org) => getProjectProvider().listProjects(ctx, org.id, { limit: 200 }))
		);
		const projects = projectPages.flatMap((p: { items: unknown[] }) => p.items);

		return {
			stats: {
				definitions: recordsPage.items.length,
				projects: projects.length,
				users: usersPage?.items.length ?? null
			},
			isPlatformAdmin
		};
	} catch (err) {
		// Let auth errors bubble up; only catch data loading failures
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Failed to load dashboard data:', err);
		return { stats: { definitions: 0, projects: 0, users: null }, isPlatformAdmin };
	}
};
