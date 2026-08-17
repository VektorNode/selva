import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Project } from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';

export interface ReclaimRow extends Project {
	memberCount: number;
}

/**
 * Org-scoped Reclaim (Permissions.md §5 `canReclaim`). Lists every project in
 * the caller's `actingOrgId`; the actor is org owner/admin and may add
 * themselves as co-owner via `POST /api/projects/[id]/reclaim`.
 *
 * Page-load gate: `manage_org_members` — held by org owner/admin only (§3),
 * never by regular members. The API endpoint runs the load-bearing
 * `canReclaim` check; this gate just keeps the page out of the wrong
 * sidebar.
 *
 * Distinct from the old `/admin/reclaim` (deleted): platform-scoped Reclaim
 * was redundant with the `instance_admin` centralized bypass (§5). Reclaim
 * exists for org leadership who don't hold the bypass.
 *
 * The `SYSTEM_CONTEXT` scan below is deliberate and is the one place in the app
 * where a leadership read is not `canView`-filtered. Reclaim's entire purpose is
 * reaching a project leadership currently *cannot* view — an orphaned private
 * project whose owner has left. Filtering this list would empty it of exactly
 * the rows the page exists to offer. The escalation itself is audited:
 * `addProjectMember` emits `project_member.added` naming the actor, so taking
 * co-ownership leaves a trace even though listing does not.
 *
 * The narrow gate is what makes that acceptable — `manage_org_members` is
 * owner/admin only (§3). Its sibling `/team/projects` gates on
 * `manage_projects`, which an admin may hand to a plain member, and therefore
 * does filter.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!ctx.actingOrgId) redirect(303, '/team');
	if (!ctx.orgPermissions.includes('manage_org_members')) redirect(303, '/team');

	const projectStore = getProjectProvider();
	void getOrganizationProvider(); // reserved for org-name lookup if we later show it

	let rows: ReclaimRow[] = [];
	try {
		const projects = await projectStore.listProjects(SYSTEM_CONTEXT, ctx.actingOrgId, {
			limit: 200
		});
		rows = await Promise.all(
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
				return { ...project, memberCount };
			})
		);
	} catch {
		// listProjects unavailable — show empty
	}

	return { projects: rows };
};
