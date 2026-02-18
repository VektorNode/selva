import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

interface DefinitionConfig {
	displayName: string;
	description: string;
	category?: string;
	tags?: string[];
	coverImage?: string;
	file?: string;
}

interface DefinitionsData {
	[guid: string]: DefinitionConfig;
}

export const load: PageServerLoad = async () => {
	const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
	const definitionsPath = resolve(process.cwd(), envPath);

	const config: DefinitionsData = {};
	const history: Record<string, string[]> = {};

	try {
		const configPath = join(definitionsPath, 'definitions-config.json');
		const configData = await readFile(configPath, 'utf-8');
		const parsed = JSON.parse(configData);
		const defs = parsed.definitions || parsed;

		for (const [guid, def] of Object.entries(defs) as [string, DefinitionConfig][]) {
			config[guid] = def;

			// Read history from old_files/ subfolder inside the GUID folder
			try {
				const oldFilesPath = join(definitionsPath, guid, 'old_files');
				const entries = await readdir(oldFilesPath);
				history[guid] = entries
					.filter((f) => f.endsWith('.gh') || f.endsWith('.ghx'))
					.sort()
					.reverse();
			} catch {
				history[guid] = [];
			}
		}
	} catch (error) {
		console.error('Failed to read definitions config:', error);
	}

	return { config, history };
};

