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
}

interface DefinitionsConfig {
	[key: string]: DefinitionConfig;
}

interface FileInfo {
	name: string;
	type: 'grasshopper' | 'image' | 'other';
}

export const load: PageServerLoad = async () => {
	// Resolve path relative to project root (where .env is)
	const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
	const definitionsPath = resolve(process.cwd(), envPath);

	// Read all files in the definitions directory
	let files: FileInfo[] = [];
	try {
		const dirEntries = await readdir(definitionsPath);
		files = dirEntries.map((name) => {
			let type: FileInfo['type'] = 'other';
			if (name.endsWith('.gh') || name.endsWith('.ghx')) {
				type = 'grasshopper';
			} else if (
				name.endsWith('.jpg') ||
				name.endsWith('.jpeg') ||
				name.endsWith('.png') ||
				name.endsWith('.gif') ||
				name.endsWith('.webp')
			) {
				type = 'image';
			}
			return { name, type };
		});
	} catch (error) {
		console.error('Failed to read definitions directory:', error);
	}

	// Read definitions config
	let config: DefinitionsConfig = {};
	try {
		const configPath = join(definitionsPath, 'definitions-config.json');
		const configData = await readFile(configPath, 'utf-8');
		const parsed = JSON.parse(configData);
		// Handle both flat and nested structures
		config = parsed.definitions || parsed;
	} catch (error) {
		console.error('Failed to read definitions-config.json:', error);
	}

	return {
		files,
		config
	};
};
