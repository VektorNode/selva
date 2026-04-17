import { getDefinitionMeta } from '$lib/server/definitions.server';
import { getOrganizationProvider, getComputeServerProvider } from '$lib/server/providers.server';
import type { DefinitionRecord, HistoryEntry } from '$lib/server/definitions.server';
import type { Project } from '@selva/platform/organizations';
import type { ComputeServerConfig } from '@selva/platform/compute';
import type { PageServerLoad } from './$types';

export type { DefinitionRecord, HistoryEntry, Project, ComputeServerConfig };

export const load: PageServerLoad = async () => {
	const meta = getDefinitionMeta();
	const orgs = getOrganizationProvider();
	const compute = getComputeServerProvider();

	try {
		const [orgList, records, computeConfig] = await Promise.all([
			orgs.listOrgs(),
			meta.list(),
			compute.getConfig()
		]);

		const projects: Project[] = (
			await Promise.all(orgList.map((org) => orgs.listProjects(org.id)))
		).flat();

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
