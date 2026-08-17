import {
	getDefinitionMeta,
	getOrganizationProvider,
	getProjectProvider,
	getComputeServerConfigStore,
	getAuthProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { projectAccessInputFromRows } from '$lib/server/access.server';
import { renderThrown } from '@selvajs/server/logging';
import {
	hasPermission,
	canView,
	canEdit,
	canManage,
	serversVisibleTo,
	defaultServerIdFor
} from '@selvajs/platform';
import type {
	DefinitionRecord,
	DefinitionVersion,
	Project,
	ProjectMember,
	ComputeServerConfig,
	AuthUser
} from '@selvajs/platform';
import type { PageServerLoad } from './$types';

export type {
	DefinitionRecord,
	DefinitionVersion,
	Project,
	ProjectMember,
	ComputeServerConfig,
	AuthUser
};

export interface ProjectWithMembers extends Project {
	/** Empty unless `canManage` — membership is not part of viewing a project. */
	members: ProjectMember[];
	/**
	 * Whether the caller can add and edit definitions in this project — owner or
	 * editor. Computed per-row so the UI can disable affordances on rows the user
	 * can only view (leadership visibility per Permissions.md §4).
	 *
	 * There is no `instance_admin` bypass here. Content access follows `canView`
	 * and `canEdit` for everyone (§2); the bypass applies to management scope
	 * only, and reclaim is the explicit escalation path into a project.
	 */
	canEdit: boolean;
	/**
	 * Whether the caller can change settings and manage members — owner only
	 * (§5). Narrower than `canEdit`: an editor edits content, not the project.
	 * The org-wide `manage_projects` permission gates whether the surface exists
	 * at all; this gates which rows it may act on.
	 */
	canManage: boolean;
}

/** User row with display name joined from the profile store. */
export interface UserListItem extends AuthUser {
	displayName?: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user)
		return {
			projects: [],
			records: [],
			computeServers: [],
			defaultComputeServerId: null,
			users: [],
			canManageProjects: false
		};

	const ctx = locals.ctx!;
	const canManageProjects = hasPermission(ctx, 'manage_projects');

	try {
		const [orgsPage, recordsPage, computeConfig] = await Promise.all([
			getOrganizationProvider().listOrgs(ctx, { limit: 200 }),
			getDefinitionMeta().list(ctx, { limit: 200 }),
			getComputeServerConfigStore().getConfig(
				ctx,
				ctx.actingOrgId ? { scopeToOrgId: ctx.actingOrgId } : {}
			)
		]);

		const projectStore = getProjectProvider();
		const orgs = getOrganizationProvider();
		const projectPages = await Promise.all(
			orgsPage.items.map((org) => projectStore.listProjects(ctx, org.id, { limit: 200 }))
		);
		const allProjects: Project[] = projectPages.flatMap((p) => p.items);

		// Resolve membership context per project: the caller's project-level row
		// (drives `canEdit`) and the caller's org-level row in that project's org
		// (drives `canView` for org/public visibility). Both arrive in one bulk
		// read each, so `canView` below runs with NO further I/O.
		// `instance_admin` gets NO content bypass — follows canView like everyone
		// else (Permissions.md §2). Reclaim is the explicit escalation path.
		const [orgMemberByOrgId, memberByProjectId] = await Promise.all([
			orgs.getOrgMembersFor(
				ctx,
				orgsPage.items.map((o) => o.id),
				ctx.userId
			),
			projectStore.getProjectMembersFor(
				ctx,
				allProjects.map((p) => p.id),
				ctx.userId
			)
		]);

		const visibleProjects = allProjects.filter((project) =>
			canView(
				projectAccessInputFromRows(ctx, project, {
					member: memberByProjectId.get(project.id) ?? null,
					orgMember: orgMemberByOrgId.get(project.orgId) ?? null
				})
			)
		);
		const accessibleProjects = visibleProjects;

		// Only show definitions belonging to accessible projects
		const projectIds = new Set(accessibleProjects.map((p) => p.id));
		const records = recordsPage.items.filter((r) => projectIds.has(r.projectId));

		const accessInput = (project: Project) =>
			projectAccessInputFromRows(ctx, project, {
				member: memberByProjectId.get(project.id) ?? null,
				orgMember: orgMemberByOrgId.get(project.orgId) ?? null
			});

		// The roster drives member-management UI, so it follows `canManage` rather
		// than the org-wide permission that decides whether that UI exists at all.
		// Seeing a project is not authority to enumerate who is in it, and
		// `manage_projects` can be held by a plain member (§11) — on a public
		// project that would otherwise list every member to them.
		const projects: ProjectWithMembers[] = await Promise.all(
			visibleProjects.map(async (project) => {
				const input = accessInput(project);
				const manageable = canManage(input);
				return {
					...project,
					members:
						canManageProjects && manageable
							? (await projectStore.listProjectMembers(ctx, project.id, { limit: 200 })).items
							: [],
					canEdit: canEdit(input),
					canManage: manageable
				};
			})
		);

		// Load users for member management — scoped to members of the active org.
		let users: UserListItem[] = [];
		if (canManageProjects && ctx.actingOrgId) {
			const memberPage = await getOrganizationProvider().listOrgMembers(ctx, ctx.actingOrgId, {
				limit: 500
			});
			const memberIds = memberPage.items.map((m) => m.userId);
			const [authUsers, profiles] = await Promise.all([
				Promise.all(
					memberIds.map((id) =>
						getAuthProvider()
							.getUser(id)
							.catch(() => null)
					)
				),
				getUserProfileStore().getProfiles(ctx, memberIds)
			]);
			const displayById = new Map(profiles.map((p) => [p.userId, p.displayName]));
			users = authUsers
				.filter((u): u is NonNullable<typeof u> => !!u)
				.map((u) => ({ ...u, displayName: displayById.get(u.id) }));
		}

		// Picker shows only servers visible to the user's acting org —
		// platform servers shared with this org (or with `'all'`, or the
		// global default) plus this org's org-private servers. The store already
		// applied this filter; re-running it covers the no-acting-org case, where
		// the read above is unscoped.
		const computeServers = serversVisibleTo(computeConfig, ctx.actingOrgId);
		const defaultComputeServerId = defaultServerIdFor(computeConfig, ctx.actingOrgId) ?? null;

		return {
			projects,
			records,
			computeServers,
			defaultComputeServerId,
			users,
			canManageProjects
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		locals.log.error('Failed to load definitions page', {
			component: 'projects',
			err: renderThrown(err)
		});
		return {
			projects: [] as ProjectWithMembers[],
			records: [] as DefinitionRecord[],
			computeServers: [] as ComputeServerConfig[],
			defaultComputeServerId: null as string | null,
			users: [] as UserListItem[],
			canManageProjects: false
		};
	}
};
