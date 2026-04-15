import { getDefinitionStore } from '$lib/server/definitions.server';
import type { HistoryEntry } from '$lib/server/definitions/types';
import type { PageServerLoad } from './$types';

// Normalize coverImage URLs: convert admin URLs to public URLs for compatibility
function normalizeImageUrl(url?: string): string | undefined {
	if (!url?.startsWith('/admin/api/definitions/')) return url;
	const match = url.match(/\/admin\/api\/definitions\/(.+?)\/(image\/.+)/);
	if (match) {
		return `/api/definitions/${match[1]}/${match[2]}`;
	}
	return url;
}

export const load: PageServerLoad = async () => {
	const store = getDefinitionStore();

	try {
		const rawConfig = await store.readConfig();
		const defs = rawConfig.definitions || {};

		const config: Record<string, (typeof defs)[string]> = {};
		const history: Record<string, HistoryEntry[]> = {};

		for (const [guid, def] of Object.entries(defs)) {
			// Normalize coverImage URLs
			config[guid] = {
				...def,
				coverImage: normalizeImageUrl(def.coverImage)
			};
			history[guid] = await store.getFileHistory(guid);
		}

		return { config, history };
	} catch (err) {
		console.error('Failed to load definitions for admin page:', err);
		return { config: {}, history: {} };
	}
};
