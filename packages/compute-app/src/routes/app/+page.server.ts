import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getDefinitionMeta, getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';
import { SYSTEM_CONTEXT } from '@selva/platform';
import type { DefinitionRecord, Project } from '@selva/platform';

export type { DefinitionRecord, Project };

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		redirect(303, `/login?redirectTo=/app`);
	}

	const user = locals.user;
	const profile = locals.profile;
	const meta = getDefinitionMeta();
	const projectStore = getProjectProvider();
	const orgs = getOrganizationProvider();

	try {
		const [orgsPage, recordsPage] = await Promise.all([
			orgs.listOrgs(SYSTEM_CONTEXT, { limit: 200 }),
			meta.list(SYSTEM_CONTEXT, { limit: 200, statuses: ['published'] })
		]);

		// Gather all projects the user can access
		const projectPages = await Promise.all(
			orgsPage.items.map((org) => projectStore.listProjects(SYSTEM_CONTEXT, org.id, { limit: 200 }))
		);
		const allProjects: Project[] = projectPages.flatMap((p) => p.items);

		// Filter to projects accessible by this user
		const accessibleProjects = await Promise.all(
			allProjects.map(async (p) => {
				if (p.visibility === 'public') return p;
				if (p.visibility === 'org') {
					const member = await orgs.getOrgMember(SYSTEM_CONTEXT, p.orgId, user.id);
					return member ? p : null;
				}
				// private
				const member = await projectStore.getProjectMember(SYSTEM_CONTEXT, p.id, user.id);
				return member ? p : null;
			})
		);

		const accessibleProjectIds = new Set(
			accessibleProjects.filter(Boolean).map((p) => p!.id)
		);

		// Only show published definitions in accessible projects
		const visibleRecords = recordsPage.items.filter((r) => accessibleProjectIds.has(r.projectId));

		// Build project map for display
		const projectMap = Object.fromEntries(allProjects.map((p) => [p.id, p]));

		// Split into starred and rest
		const starredIds = new Set(profile.starredDefinitions);
		const starred = visibleRecords.filter((r) => starredIds.has(r.guid));
		const rest = visibleRecords.filter((r) => !starredIds.has(r.guid));

		return {
			records: rest,
			starredRecords: starred,
			recentRuns: profile.recentRuns,
			projects: Object.fromEntries(
				accessibleProjects.filter(Boolean).map((p) => [p!.id, { id: p!.id, name: p!.name }])
			),
			projectMap
		};
	} catch (err) {
		console.error('[App Home] Failed to load definitions:', err);
		return {
			records: [] as DefinitionRecord[],
			starredRecords: [] as DefinitionRecord[],
			recentRuns: profile.recentRuns,
			projects: {} as Record<string, { id: string; name: string }>,
			projectMap: {} as Record<string, Project>
		};
	}
};
