import {
	getDefinitionMeta,
	getOrganizationProvider,
	getComputeServerConfigStore
} from '$lib/server/providers.server';
import { SYSTEM_CONTEXT } from '@selva/platform';
import type {
	DefinitionRecord,
	HistoryEntry,
	Project,
	ComputeServerConfig
} from '@selva/platform';
import type { PageServerLoad } from './$types';
import { assertManageDefinitions } from '$lib/server/access.server';

export type { DefinitionRecord, HistoryEntry, Project, ComputeServerConfig };

export const load: PageServerLoad = async ({ locals }) => {
	assertManageDefinitions(locals);
	const ctx = locals.ctx ?? SYSTEM_CONTEXT;
	const meta = getDefinitionMeta();
	const orgs = getOrganizationProvider();
	const compute = getComputeServerConfigStore();

	try {
		const [orgsPage, recordsPage, computeConfig] = await Promise.all([
			orgs.listOrgs(ctx, { limit: 200 }),
			meta.list(ctx, { limit: 200 }),
			compute.getConfig()
		]);

		const projectPages = await Promise.all(
			orgsPage.items.map((org) => orgs.listProjects(ctx, org.id, { limit: 200 }))
		);
		const allProjects: Project[] = projectPages.flatMap((p) => p.items);

		// Filter to projects the current user can actually edit
		const editableFlags = await Promise.all(allProjects.map((p) => orgs.canEdit(ctx, p.id)));
		const projects = allProjects.filter((_, i) => editableFlags[i]);

		// Only show definitions belonging to accessible projects
		const projectIds = new Set(projects.map((p) => p.id));
		const records = recordsPage.items.filter((r) => projectIds.has(r.projectId));

		return { projects, records, computeServers: computeConfig.servers };
	} catch (err) {
		console.error('Failed to load definitions page data:', err);
		return {
			projects: [] as Project[],
			records: [] as DefinitionRecord[],
			computeServers: [] as ComputeServerConfig[]
		};
	}
};
