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
	serversVisibleTo,
	defaultServerIdFor
} from '@selvajs/platform';
import type {
	DefinitionRecord,
	DefinitionVersion,
	OrgMember,
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
	members: ProjectMember[];
	/**
	 * Whether the caller can edit this project (add/edit definitions, change
	 * settings). Computed per-row so the UI can disable affordances on rows the
	 * user can only view (leadership visibility per Permissions.md §4).
	 * `instance_admin` always edits via the centralized bypass.
	 */
	canEdit: boolean;
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
			getComputeServerConfigStore().getConfig(ctx)
		]);

		const projectStore = getProjectProvider();
		const orgs = getOrganizationProvider();
		const projectPages = await Promise.all(
			orgsPage.items.map((org) => projectStore.listProjects(ctx, org.id, { limit: 200 }))
		);
		const allProjects: Project[] = projectPages.flatMap((p) => p.items);

		// Resolve membership context per project: the caller's project-level row
		// (drives `canEdit`) and the caller's org-level row in that project's org
		// (drives `canView` for org/public visibility). Org rows fetched once per
		// org and reused across that org's projects to avoid N+1.
		// `instance_admin` gets NO content bypass — follows canView like everyone
		// else (Permissions.md §2). Reclaim is the explicit escalation path.
		const orgMemberByOrgId = new Map<string, OrgMember | null>();
		await Promise.all(
			orgsPage.items.map(async (org) => {
				const m = await orgs.getOrgMember(ctx, org.id, ctx.userId).catch(() => null);
				orgMemberByOrgId.set(org.id, m);
			})
		);
		const projectMembers = await Promise.all(
			allProjects.map((p) => projectStore.getProjectMember(ctx, p.id, ctx.userId))
		);

		const visibleIndexes = allProjects
			.map((project, i) => ({ project, i }))
			.filter(({ project, i }) =>
				canView(
					projectAccessInputFromRows(ctx, project, {
						member: projectMembers[i],
						orgMember: orgMemberByOrgId.get(project.orgId) ?? null
					})
				)
			);
		const accessibleProjects = visibleIndexes.map(({ project }) => project);

		// Only show definitions belonging to accessible projects
		const projectIds = new Set(accessibleProjects.map((p) => p.id));
		const records = recordsPage.items.filter((r) => projectIds.has(r.projectId));

		// Load members for projects if user can manage projects
		let projects: ProjectWithMembers[];
		const editInput = (project: Project, i: number) =>
			projectAccessInputFromRows(ctx, project, {
				member: projectMembers[i],
				orgMember: orgMemberByOrgId.get(project.orgId) ?? null
			});

		if (canManageProjects) {
			projects = await Promise.all(
				visibleIndexes.map(async ({ project, i }) => ({
					...project,
					members: (await projectStore.listProjectMembers(ctx, project.id, { limit: 200 })).items,
					canEdit: canEdit(editInput(project, i))
				}))
			);
		} else {
			projects = visibleIndexes.map(({ project, i }) => ({
				...project,
				members: [],
				canEdit: canEdit(editInput(project, i))
			}));
		}

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
		// global default) plus this org's org-private servers.
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
