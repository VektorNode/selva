import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Project } from '@selvajs/platform';
import { SYSTEM_CONTEXT, hasPermission } from '@selvajs/platform';
import { getProjectProvider } from '#lib/server/providers.server.js';
import { resolveAccessibleProjects } from '@selvajs/server/definitions';
import { accessDepsFromConfig } from '#lib/server/access.server.js';

export interface ProjectRow extends Project {
	memberCount: number;
}

/**
 * Org project management. Gated on `manage_projects`, which §11 says an admin
 * may grant a plain org `member` — so the gate says "may administer projects",
 * never "may see every project".
 *
 * Rows therefore come from `resolveAccessibleProjects`, the same `canView`
 * filter the library and `/projects` use, not from a raw `listProjects`. That
 * listing is unfiltered on the local provider (`LocalProjectStore.listProjects`
 * takes `_ctx`) and filtered by RLS on Supabase, so relying on it would have
 * made this page mean different things per deployment — and on local it named
 * every private project in the org, with a live Delete button beside each.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'manage_projects')) redirect(303, '/team');

	const orgId = ctx.actingOrgId;
	if (!orgId) {
		return { projects: [] as ProjectRow[], canCreate: false };
	}

	let rows: ProjectRow[] = [];

	try {
		const { projects: visible } = await resolveAccessibleProjects(
			ctx,
			accessDepsFromConfig(locals.providers)
		);
		const inOrg = visible.filter((p) => p.orgId === orgId);
		const store = getProjectProvider();
		// Counting members of a project the caller can already view is a
		// leadership read, not a second visibility decision — the filter
		// above is what made this project nameable at all.
		const counts = await store
			.countProjectMembers(
				SYSTEM_CONTEXT,
				inOrg.map((p) => p.id)
			)
			.catch(() => new Map<string, number>());
		rows = inOrg.map((project) => ({ ...project, memberCount: counts.get(project.id) ?? 0 }));
	} catch {
		// non-fatal — show empty
	}

	return { projects: rows, canCreate: true };
};
