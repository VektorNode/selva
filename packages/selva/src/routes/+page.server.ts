import type { PageServerLoad } from './$types';
import { listVisibleDefinitions } from '$lib/server/definitions/visibility.server';
import { renderThrown } from '@selvajs/server/logging';
import type { DefinitionRecord } from '@selvajs/platform';

/** Dashboard rows, newest-first, capped so the page stays one screen. */
const STARRED_LIMIT = 6;
const RECENT_LIMIT = 5;

export interface DashboardData {
	starred: DefinitionRecord[];
	/** Newest-first, deduped by definition — one row per tool, not per run. */
	recentRuns: { definitionId: string; runId: string; definitionName: string; timestamp: string }[];
	projects: Record<string, { id: string; name: string }>;
	/** Total published definitions the user can reach, for the "browse all" hint. */
	visibleCount: number;
}

/**
 * Anonymous visitors get the branded splash and no query at all — the landing
 * page is public, so this load must stay cheap and side-effect free for them.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		return { dashboard: null };
	}

	const profile = locals.profile;

	try {
		const { items, projects } = await listVisibleDefinitions(locals.ctx!, {
			limit: 200,
			statuses: ['published']
		});

		const starredIds = new Set(profile.starredDefinitions);
		const byGuid = new Map(items.map((r) => [r.guid, r]));

		// A run whose definition was unpublished or lost visibility must not
		// render a dead row — resolve against the visible set and drop misses.
		const seen = new Set<string>();
		const recentRuns = profile.recentRuns
			.filter((run) => {
				if (!byGuid.has(run.definitionId) || seen.has(run.definitionId)) return false;
				seen.add(run.definitionId);
				return true;
			})
			.slice(0, RECENT_LIMIT);

		const dashboard: DashboardData = {
			starred: items.filter((r) => starredIds.has(r.guid)).slice(0, STARRED_LIMIT),
			recentRuns,
			projects: Object.fromEntries(projects.map((p) => [p.id, { id: p.id, name: p.name }])),
			visibleCount: items.length
		};

		return { dashboard };
	} catch (err) {
		locals.log.error('Failed to load dashboard', {
			component: 'Landing',
			err: renderThrown(err)
		});
		return { dashboard: null };
	}
};
