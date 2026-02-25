import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { watch } from 'node:fs';
import type {
	IDefinitionLoader,
	Definition,
	DefinitionMetadata,
	DefinitionsConfig,
	DefinitionFileType
} from '../types';

export interface FilesystemLoaderConfig {
	definitionsPath: string;
	supportedExtensions?: DefinitionFileType[];
}

/** UUID v4 pattern */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FilesystemDefinitionLoader implements IDefinitionLoader {
	private config: Required<FilesystemLoaderConfig>;
	protected configCache: DefinitionsConfig | undefined;
	private watcher: ReturnType<typeof watch> | null = null;

	constructor(config: FilesystemLoaderConfig) {
		this.config = {
			supportedExtensions: ['gh', 'ghx'],
			...config
		};
		this.setupFileWatcher();
	}

	private setupFileWatcher(): void {
		try {
			const configPath = this.getConfigPath();
			this.watcher = watch(configPath, (eventType) => {
				if (eventType === 'change' || eventType === 'rename') {
					this.configCache = undefined;
				}
			});
		} catch {
			// okay if file doesn't exist yet
		}
	}

	private getConfigPath(): string {
		return path.join(this.config.definitionsPath, 'definitions-config.json');
	}

	private async loadConfigFile(): Promise<DefinitionsConfig> {
		if (this.configCache !== undefined) return this.configCache;

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
		if (ext === 'gh' || ext === 'ghx') return ext as DefinitionFileType;
		throw new Error(`Unsupported file type: .${ext}`);
	}

	private ensureExtension(filename: string): string {
		if (!filename.endsWith('.gh') && !filename.endsWith('.ghx')) {
			return filename + '.gh';
		}
		return filename;
	}

	/**
	 * Resolve an identifier to { guid, filename }.
	 * - UUID → direct GUID lookup in config
	 * - filename → search all definitions by `file` field (backward compat)
	 */
	private async resolveIdentifier(identifier: string): Promise<{ guid: string; filename: string }> {
		const config = await this.loadConfigFile();
		const defs = config.definitions || {};

		// Direct GUID lookup
		if (UUID_REGEX.test(identifier)) {
			const meta = defs[identifier];
			if (!meta) throw new Error(`Definition with GUID '${identifier}' not found`);
			if (!meta.file) throw new Error(`Definition '${identifier}' has no file associated`);
			return { guid: identifier, filename: meta.file };
		}

		// Filename lookup (with or without extension)
		const filenameWithExt = this.ensureExtension(identifier);
		for (const [guid, meta] of Object.entries(defs)) {
			if (meta.file === identifier || meta.file === filenameWithExt) {
				if (!meta.file) throw new Error(`Definition '${guid}' has no file associated`);
				return { guid, filename: meta.file };
			}
		}

		throw new Error(`Definition '${identifier}' not found`);
	}

	async listDefinitions(): Promise<Definition[]> {
		const config = await this.loadConfigFile();
		const defs = config.definitions || {};
		const definitions: Definition[] = [];

		for (const [guid, metadata] of Object.entries(defs)) {
			if (!metadata.file) continue;
			try {
				const fileType = this.getFileType(metadata.file);
				definitions.push({
					guid,
					filename: metadata.file,
					fileType,
					...metadata
				});
			} catch {
				console.warn(`[FilesystemLoader] Skipping '${guid}': unsupported file type`);
			}
		}

		definitions.sort((a, b) => a.displayName.localeCompare(b.displayName));
		return definitions;
	}

	async getMetadata(identifier: string): Promise<DefinitionMetadata> {
		const { guid } = await this.resolveIdentifier(identifier);
		const config = await this.loadConfigFile();
		return config.definitions[guid];
	}

	async loadDefinition(identifier: string): Promise<Uint8Array> {
		const { guid, filename } = await this.resolveIdentifier(identifier);
		const filePath = path.join(this.config.definitionsPath, guid, filename);
		try {
			await fs.access(filePath);
			const fileBuffer = await fs.readFile(filePath);
			return new Uint8Array(fileBuffer);
		} catch (err) {
			throw new Error(`Failed to read definition at '${filePath}': ${err}`);
		}
	}

	async getDefinitionUrl(identifier: string): Promise<string> {
		const { guid } = await this.resolveIdentifier(identifier);
		// Return GUID as the stable local identifier
		return `local:${guid}`;
	}
}
