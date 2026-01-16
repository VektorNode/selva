import type { PageServerLoad } from './$types';
import { getDefinitionContainer } from '$lib/server/definitions.server';

export const load = (async () => {
	try {
		const container = getDefinitionContainer();
		const definitions = await container.listDefinitions();

		return {
			definitions,
			mode: 'local',
			hasMultiple: definitions.length > 1
		};
	} catch (configErr) {
		// Config loading failed - return error state
		console.error('[Root Load] Failed to load definitions config:', configErr);
		return {
			definitions: [],
			mode: 'error',
			error: configErr instanceof Error ? configErr.message : String(configErr)
		};
	}
}) satisfies PageServerLoad;
