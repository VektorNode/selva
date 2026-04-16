import { getDefinitionMeta } from '$lib/server/definitions.server';
import type { HistoryEntry } from '$lib/server/definitions.server';
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
	const meta = getDefinitionMeta();

	try {
		const records = await meta.list();

		const config: Record<string, {
			displayName: string;
			description?: string;
			coverImage?: string;
			category?: string;
			tags?: string[];
			originalFilename?: string;
			file?: string;
			maxHistory?: number;
		}> = {};
		const history: Record<string, HistoryEntry[]> = {};

		for (const record of records) {
			config[record.guid] = {
				displayName: record.meta.displayName,
				description: record.meta.description,
				coverImage: normalizeImageUrl(record.meta.coverImage),
				category: record.meta.category,
				tags: record.meta.tags,
				originalFilename: record.meta.originalFilename,
				file: `definition.${record.fileExt}`,
				maxHistory: record.maxHistory > 0 ? record.maxHistory : undefined
			};
			history[record.guid] = record.history;
		}

		return { config, history };
	} catch (err) {
		console.error('Failed to load definitions for admin page:', err);
		return { config: {}, history: {} };
	}
};
