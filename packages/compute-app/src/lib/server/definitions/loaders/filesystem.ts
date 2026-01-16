import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IDefinitionLoader, Definition, DefinitionMetadata, DefinitionsConfig, DefinitionFileType } from '../types';

export interface FilesystemLoaderConfig {
	definitionsPath: string;
	supportedExtensions?: DefinitionFileType[];
}

export class FilesystemDefinitionLoader implements IDefinitionLoader {
	private config: Required<FilesystemLoaderConfig>;
	private configCache: DefinitionsConfig | undefined;

	constructor(config: FilesystemLoaderConfig) {
		this.config = {
			supportedExtensions: ['gh', 'ghx'],
			...config
		};
	}

	private getConfigPath(): string {
		return path.join(this.config.definitionsPath, 'definitions-config.json');
	}

	private async loadConfigFile(): Promise<DefinitionsConfig> {
		if (this.configCache !== undefined) {
			return this.configCache;
		}

		try {
			const configPath = this.getConfigPath();
			const content = await fs.readFile(configPath, 'utf-8');
			const parsed = JSON.parse(content) as DefinitionsConfig;
			this.configCache = parsed;
			return parsed;
		} catch (err) {
			throw new Error(`Failed to load definitions config: ${err}`);
		}
	}

	private getFileType(filename: string): DefinitionFileType {
		const ext = path.extname(filename).toLowerCase().slice(1);
		if (ext === 'gh' || ext === 'ghx') {
			return ext as DefinitionFileType;
		}
		throw new Error(`Unsupported file type: ${ext}. Supported: ${this.config.supportedExtensions.join(', ')}`);
	}

	private sanitizeFilename(filename: string): string {
		// Add extension if missing
		if (!filename.endsWith('.gh') && !filename.endsWith('.ghx')) {
			filename += '.gh';
		}
		// Prevent directory traversal
		const safe = path.basename(filename);
		if (safe !== filename || !/^[a-zA-Z0-9_\-.]+$/.test(safe)) {
			throw new Error('Invalid filename');
		}
		return safe;
	}

	async listDefinitions(): Promise<Definition[]> {
		const config = await this.loadConfigFile();

		if (!config.definitions || typeof config.definitions !== 'object') {
			throw new Error('Invalid config format: missing "definitions" object');
		}

		const definitions: Definition[] = [];

		for (const [filename, metadata] of Object.entries(config.definitions)) {
			try {
				const fileType = this.getFileType(filename);
				definitions.push({
					filename,
					fileType,
					...metadata
				});
			} catch {
				console.warn(`[FilesystemLoader] Skipping definition with unsupported file type: ${filename}`);
			}
		}

		// Sort by displayName
		definitions.sort((a, b) => a.displayName.localeCompare(b.displayName));

		return definitions;
	}

	async getMetadata(filename: string): Promise<DefinitionMetadata> {
		const safeFilename = this.sanitizeFilename(filename);
		const config = await this.loadConfigFile();
		const metadata = config.definitions[safeFilename];

		if (!metadata) {
			throw new Error(`Definition '${safeFilename}' not found in config`);
		}

		return metadata;
	}

	async loadDefinition(filename: string): Promise<Uint8Array> {
		const safeFilename = this.sanitizeFilename(filename);
		const filePath = path.join(this.config.definitionsPath, safeFilename);

		try {
			await fs.access(filePath);
			const fileBuffer = await fs.readFile(filePath);
			return new Uint8Array(fileBuffer);
		} catch (err) {
			throw new Error(
				`Failed to read definition '${safeFilename}' at '${filePath}': ${err}`
			);
		}
	}

	async getDefinitionUrl(filename: string): Promise<string> {
		const safeFilename = this.sanitizeFilename(filename);
		// For filesystem loader, return a special protocol URL
		return `local:${safeFilename}`;
	}
}
