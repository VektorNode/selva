import { getServerConfig } from './config.server';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface DefinitionMetadata {
	displayName: string;
	description?: string;
	coverImage?: string;
	category?: string;
	tags?: string[];
}

export interface Definition extends DefinitionMetadata {
	filename: string;
}

export interface DefinitionsConfig {
	definitions: Record<string, DefinitionMetadata>;
}

/**
 * Load definitions from config file
 * Expects: GH_DEFINITIONS_PATH/definitions-config.json
 */
export async function loadDefinitionsConfig(): Promise<Definition[]> {
	const config = getServerConfig();

	if (!config.ghDefinitionsPath) {
		return [];
	}

	const configPath = path.join(config.ghDefinitionsPath, 'definitions-config.json');

	try {
		const configFile = await fs.readFile(configPath, 'utf-8');
		const parsed: DefinitionsConfig = JSON.parse(configFile);

		if (!parsed.definitions || typeof parsed.definitions !== 'object') {
			throw new Error('Invalid config format: missing "definitions" object');
		}

		const definitions: Definition[] = Object.entries(parsed.definitions).map(
			([filename, metadata]) => ({
				filename,
				...metadata
			})
		);

		// Sort by displayName
		definitions.sort((a, b) => a.displayName.localeCompare(b.displayName));

		return definitions;
	} catch (err) {
		if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
			throw new Error(
				`No definitions-config.json found at ${configPath}. ` +
					`Please create this file with your definition metadata.`
			);
		}
		throw err;
	}
}
