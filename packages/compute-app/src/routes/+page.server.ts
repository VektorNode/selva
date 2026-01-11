import type { PageServerLoad } from './$types';
import { loadDefinitionsConfig } from '$lib/server/definitions.server';
import { getServerConfig } from '$lib/server/config.server';

export const load = (async () => {
	try {
		const config = getServerConfig();

		// Only load definitions if using local file system
		if (!config.ghDefinitionsPath) {
			return {
				definitions: [],
				mode: 'url',
				defaultGhUrl: config.ghDefinitionsBaseUrl
			};
		}

		try {
			const definitions = await loadDefinitionsConfig();

			return {
				definitions,
				mode: 'local',
				defaultGhUrl: config.ghDefinitionsBaseUrl,
				hasMultiple: definitions.length > 1
			};
		} catch (configErr) {
			// Config loading failed - return error state
			console.error('[Root Load] Failed to load definitions config:', configErr);
			return {
				definitions: [],
				mode: 'error',
				defaultGhUrl: '',
				error: configErr instanceof Error ? configErr.message : String(configErr)
			};
		}
	} catch (err) {
		console.error('[Root Load] Unexpected error:', err);
		return {
			definitions: [],
			mode: 'error',
			defaultGhUrl: '',
			error: 'An unexpected error occurred while loading definitions'
		};
	}
}) satisfies PageServerLoad;
