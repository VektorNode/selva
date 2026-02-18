import { getDefinitionStore } from '$lib/server/definitions.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const store = getDefinitionStore();

	try {
		const rawConfig = await store.readConfig();
		const defs = rawConfig.definitions || {};

		const config: Record<string, (typeof defs)[string]> = {};
		const history: Record<string, string[]> = {};

		for (const [guid, def] of Object.entries(defs)) {
			config[guid] = def;
			history[guid] = await store.getFileHistory(guid);
		}

		return { config, history };
	} catch (err) {
		console.error('Failed to load definitions for admin page:', err);
		return { config: {}, history: {} };
	}
};


