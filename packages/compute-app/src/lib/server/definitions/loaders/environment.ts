import type {
	IDefinitionLoader,
	Definition,
	DefinitionMetadata,
	DefinitionFileType
} from '../types';

export interface EnvironmentLoaderConfig {
	prefix?: string;
	envVars?: Record<string, string | undefined>;
}

export class EnvironmentDefinitionLoader implements IDefinitionLoader {
	private prefix: string;
	private envVars: Record<string, string | undefined>;

	constructor(config: EnvironmentLoaderConfig = {}) {
		this.prefix = config.prefix || 'GH_DEF_';
		// Use provided envVars or fall back to process.env
		this.envVars = config.envVars || process.env;
	}

	private getFileType(filename: string): DefinitionFileType {
		const parts = filename.split('.');
		const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'gh';
		if (ext === 'gh' || ext === 'ghx') {
			return ext as DefinitionFileType;
		}
		throw new Error(`Unsupported file type: ${ext}`);
	}

	private parseDefinitionEnv(value: string): { metadata: DefinitionMetadata; url: string } {
		try {
			return JSON.parse(value);
		} catch {
			throw new Error('Definition environment variable must be valid JSON');
		}
	}

	async listDefinitions(): Promise<Definition[]> {
		const definitions: Definition[] = [];

		for (const [key, value] of Object.entries(this.envVars)) {
			if (!key.startsWith(this.prefix) || !value) {
				continue;
			}

			try {
				const filename = key.slice(this.prefix.length);
				const { metadata } = this.parseDefinitionEnv(value);
				const fileType = this.getFileType(filename);

				definitions.push({
					filename,
					fileType,
					...metadata
				});
			} catch (err) {
				console.warn(`[EnvironmentLoader] Failed to parse definition from ${key}: ${err}`);
			}
		}

		// Sort by displayName
		definitions.sort((a, b) => a.displayName.localeCompare(b.displayName));

		return definitions;
	}

	async getMetadata(filename: string): Promise<DefinitionMetadata> {
		const envKey = `${this.prefix}${filename}`;
		const value = this.envVars[envKey];

		if (!value) {
			throw new Error(`Definition '${filename}' not found in environment variables`);
		}

		const { metadata } = this.parseDefinitionEnv(value);
		return metadata;
	}

	async loadDefinition(filename: string): Promise<Uint8Array> {
		const url = await this.getDefinitionUrl(filename);

		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Failed to fetch definition: ${response.statusText}`);
			}
			return new Uint8Array(await response.arrayBuffer());
		} catch (err) {
			throw new Error(`Failed to load definition from ${url}: ${err}`);
		}
	}

	async getDefinitionUrl(filename: string): Promise<string> {
		const envKey = `${this.prefix}${filename}`;
		const value = this.envVars[envKey];

		if (!value) {
			throw new Error(`Definition '${filename}' not found in environment variables`);
		}

		const { url } = this.parseDefinitionEnv(value);
		return url;
	}
}
