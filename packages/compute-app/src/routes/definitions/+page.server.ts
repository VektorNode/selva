import {
	getDefinitionMeta,
	getOrganizationProvider,
	getProjectProvider,
	getComputeServerConfigStore,
	getAuthProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { hasPermission } from '@selva/platform';
import type {
	DefinitionRecord,
	HistoryEntry,
	Project,
	ProjectMember,
	ComputeServerConfig,
	AuthUser
} from '@selva/platform';
import type { PageServerLoad } from './$types';

export type { DefinitionRecord, HistoryEntry, Project, ProjectMember, ComputeServerConfig, AuthUser };

export interface ProjectWithMembers extends Project {
	members: ProjectMember[];
}

/** User row with display name joined from the profile store (§1e). */
export interface UserListItem extends AuthUser {
	displayName?: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { projects: [], records: [], computeServers: [], users: [], canManageProjects: false, isPlatformAdmin: false };

	const ctx = locals.ctx!;
	const canManageProjects = hasPermission(ctx, 'manage_projects');
	const isPlatformAdmin = hasPermission(ctx, 'instance_admin');

	try {
		const [orgsPage, recordsPage, computeConfig] = await Promise.all([
			getOrganizationProvider().listOrgs(ctx, { limit: 200 }),
			getDefinitionMeta().list(ctx, { limit: 200 }),
			getComputeServerConfigStore().getConfig(ctx)
		]);

		const projectStore = getProjectProvider();
		const projectPages = await Promise.all(
			orgsPage.items.map((org) => projectStore.listProjects(ctx, org.id, { limit: 200 }))
		);
		const allProjects: Project[] = projectPages.flatMap((p) => p.items);

		// Filter to projects the current user can actually edit
		const editableFlags = await Promise.all(allProjects.map((p) => projectStore.canEdit(ctx, p.id)));
		const accessibleProjects = isPlatformAdmin
			? allProjects
			: allProjects.filter((_, i) => editableFlags[i]);

		// Only show definitions belonging to accessible projects
		const projectIds = new Set(accessibleProjects.map((p) => p.id));
		const records = recordsPage.items.filter((r) => projectIds.has(r.projectId));

		// Load members for projects if user can manage projects
		let projects: ProjectWithMembers[];
		if (canManageProjects || isPlatformAdmin) {
			projects = await Promise.all(
				accessibleProjects.map(async (p) => ({
					...p,
					members: (await projectStore.listProjectMembers(ctx, p.id, { limit: 200 })).items
				}))
			);
		} else {
			projects = accessibleProjects.map((p) => ({ ...p, members: [] }));
		}

		// Load users for member management, with display names joined from profiles.
		let users: UserListItem[] = [];
		if (canManageProjects || isPlatformAdmin) {
			const usersPage = await getAuthProvider().listUsers({ limit: 200 });
			const authUsers = usersPage?.items ?? [];
			const profiles = await getUserProfileStore().getProfiles(authUsers.map((u) => u.id));
			const displayById = new Map(profiles.map((p) => [p.userId, p.displayName]));
			users = authUsers.map((u) => ({ ...u, displayName: displayById.get(u.id) }));
		}

		return {
			projects,
			records,
			computeServers: computeConfig.servers,
			users,
			canManageProjects: canManageProjects || isPlatformAdmin,
			isPlatformAdmin
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Failed to load definitions page:', err);
		return {
			projects: [] as ProjectWithMembers[],
			records: [] as DefinitionRecord[],
			computeServers: [] as ComputeServerConfig[],
			users: [] as UserListItem[],
			canManageProjects: false,
			isPlatformAdmin: false
		};
	}
};
