import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import {
	getDefinitionMeta,
	getOrganizationProvider,
	getProjectProvider,
	getPlatformProjectGrantStore
} from '$lib/server/providers.server';
import { projectAccessInputFromRows } from '$lib/server/access.server';
import { renderThrown } from '@selvajs/server/logging';
import { SYSTEM_CONTEXT, canView } from '@selvajs/platform';
import type { DefinitionRecord, Project, OrgMember } from '@selvajs/platform';

export type { DefinitionRecord, Project };

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		redirect(303, `/login?redirectTo=/library`);
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

		const grantStore = getPlatformProjectGrantStore();
		const ctx = locals.ctx;

		// Access filtering, batched to avoid a per-project N+1 (§2c — same pattern
		// as /projects). Fetch the membership rows the rules consult in a few
		// bulk calls, then evaluate `canView` with NO further I/O:
		//   - org member row once per org (reused across that org's projects);
		//   - project member row for every project in one Promise.all;
		//   - platform grants only for platform-visibility projects.
		const orgMemberByOrgId = new Map<string, OrgMember | null>();
		await Promise.all(
			orgsPage.items.map(async (org) => {
				const m = await orgs.getOrgMember(SYSTEM_CONTEXT, org.id, user.id).catch(() => null);
				orgMemberByOrgId.set(org.id, m);
			})
		);
		const projectMembers = await Promise.all(
			allProjects.map((p) => projectStore.getProjectMember(SYSTEM_CONTEXT, p.id, user.id))
		);
		const platformGrantsByProjectId = new Map<
			string,
			Awaited<ReturnType<typeof grantStore.listByProject>>
		>();
		await Promise.all(
			allProjects
				.filter((p) => p.visibility === 'platform')
				.map(async (p) => {
					platformGrantsByProjectId.set(p.id, await grantStore.listByProject(SYSTEM_CONTEXT, p.id));
				})
		);

		const accessibleProjects = allProjects.filter((project, i) =>
			ctx
				? canView(
						projectAccessInputFromRows(ctx, project, {
							member: projectMembers[i],
							orgMember: orgMemberByOrgId.get(project.orgId) ?? null,
							platformGrants: platformGrantsByProjectId.get(project.id) ?? []
						})
					)
				: project.visibility === 'public'
		);

		const accessibleProjectIds = new Set(accessibleProjects.map((p) => p.id));

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
				accessibleProjects.map((p) => [p.id, { id: p.id, name: p.name }])
			),
			projectMap
		};
	} catch (err) {
		locals.log.error('Failed to load definitions', {
			component: 'App Home',
			err: renderThrown(err)
		});
		return {
			records: [] as DefinitionRecord[],
			starredRecords: [] as DefinitionRecord[],
			recentRuns: profile.recentRuns,
			projects: {} as Record<string, { id: string; name: string }>,
			projectMap: {} as Record<string, Project>
		};
	}
};
