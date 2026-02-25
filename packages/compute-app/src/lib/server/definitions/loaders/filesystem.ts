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

/** A file is "stable" if it's already named definition.gh or definition.ghx */
function isStableFilename(filename: string): boolean {
	return filename === 'definition.gh' || filename === 'definition.ghx';
}

function stableFilename(ext: string): string {
	return `definition${ext}`;
}

export class FilesystemDefinitionLoader implements IDefinitionLoader {
	private config: Required<FilesystemLoaderConfig>;
	protected configCache: DefinitionsConfig | undefined;
	private _watcher: ReturnType<typeof watch> | null = null;

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
			this._watcher = watch(configPath, (eventType) => {
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

	/**
	 * Migrate a legacy definition entry: rename the on-disk file from its original name
	 * to "definition.gh" / "definition.ghx" and update the config entry in place.
	 * Returns the stable filename.
	 */
	protected async migrateToStableFilename(
		guid: string,
		meta: DefinitionMetadata,
		config: DefinitionsConfig
	): Promise<string> {
		if (!meta.file) return 'definition.gh';

		const ext = path.extname(meta.file).toLowerCase();
		const stable = stableFilename(ext);
		const guidDir = path.join(this.config.definitionsPath, guid);
		const oldPath = path.join(guidDir, meta.file);
		const newPath = path.join(guidDir, stable);

		try {
			await fs.rename(oldPath, newPath);
		} catch {
			// File may already be gone or already renamed — proceed
		}

		// Update config entry
		meta.originalFilename = meta.originalFilename ?? meta.file;
		meta.file = stable;
		config.definitions[guid] = meta;

		// Write config and bust cache
		const configPath = this.getConfigPath();
		const tmpPath = `${configPath}.tmp`;
		await fs.writeFile(tmpPath, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmpPath, configPath);
		this.configCache = undefined;

		return stable;
	}

	/**
	 * Resolve an identifier to { guid, filename }.
	 * - UUID → direct GUID lookup in config, migrating old-style entries on the fly
	 * - filename → search all definitions by originalFilename or file field (backward compat)
	 */
	private async resolveIdentifier(identifier: string): Promise<{ guid: string; filename: string }> {
		const config = await this.loadConfigFile();
		const defs = config.definitions || {};

		// Direct GUID lookup
		if (UUID_REGEX.test(identifier)) {
			const meta = defs[identifier];
			if (!meta) throw new Error(`Definition with GUID '${identifier}' not found`);
			if (!meta.file) throw new Error(`Definition '${identifier}' has no file associated`);

			// Migrate old-style entry on first access
			if (!isStableFilename(meta.file)) {
				const stable = await this.migrateToStableFilename(identifier, meta, config);
				return { guid: identifier, filename: stable };
			}

			return { guid: identifier, filename: meta.file };
		}

		// Filename / originalFilename lookup (backward compat)
		for (const [guid, meta] of Object.entries(defs)) {
			if (meta.originalFilename === identifier || meta.file === identifier) {
				if (!meta.file) throw new Error(`Definition '${guid}' has no file associated`);
				if (!isStableFilename(meta.file)) {
					const stable = await this.migrateToStableFilename(guid, meta, config);
					return { guid, filename: stable };
				}
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
				// Migrate old-style entries lazily
				let file = metadata.file;
				if (!isStableFilename(file)) {
					file = await this.migrateToStableFilename(guid, metadata, config);
				}
				const fileType = this.getFileType(file);
				definitions.push({
					guid,
					filename: file,
					fileType,
					...metadata,
					file
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
		return `local:${guid}`;
	}
}
