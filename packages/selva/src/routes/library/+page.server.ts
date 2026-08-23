import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { listVisibleDefinitions } from '@selvajs/server/definitions';
import { accessDepsFromConfig } from '$lib/server/access.server';
import { renderThrown } from '@selvajs/server/logging';
import type { DefinitionRecord, Project } from '@selvajs/platform';

export type { DefinitionRecord, Project };

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		redirect(303, `/login?redirectTo=/library`);
	}

	const profile = locals.profile;

	try {
		const { items: visibleRecords, projects: accessibleProjects } = await listVisibleDefinitions(
			locals.ctx!,
			{ limit: 200, statuses: ['published'] },
			accessDepsFromConfig(locals.providers)
		);

		const projectMap = Object.fromEntries(accessibleProjects.map((p) => [p.id, p]));

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
