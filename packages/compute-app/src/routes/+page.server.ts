import type { PageServerLoad } from './$types';
import { getDefinitionMeta } from '$lib/server/definitions.server';

export const load = (async () => {
	try {
		const meta = getDefinitionMeta();
		const records = await meta.list();

		const definitions = records.map((r) => ({
			guid: r.guid,
			filename: `definition.${r.fileExt}`,
			fileType: r.fileExt,
			displayName: r.meta.displayName,
			description: r.meta.description,
			coverImage: r.meta.coverImage,
			category: r.meta.category,
			tags: r.meta.tags,
			originalFilename: r.meta.originalFilename,
			file: `definition.${r.fileExt}`
		}));

		return {
			definitions,
			mode: 'local',
			hasMultiple: definitions.length > 1
		};
	} catch (configErr) {
		console.error('[Root Load] Failed to load definitions config:', configErr);
		return {
			definitions: [],
			mode: 'error',
			error: configErr instanceof Error ? configErr.message : String(configErr)
		};
	}
}) satisfies PageServerLoad;
