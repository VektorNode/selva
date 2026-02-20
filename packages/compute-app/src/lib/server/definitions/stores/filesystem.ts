import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FilesystemDefinitionLoader } from '../loaders/filesystem';
import type {
	IDefinitionStore,
	DefinitionMetadata,
	DefinitionsConfig,
	FileInput,
	CreateDefinitionInput
} from '../types';

const GH_EXTENSIONS = ['.gh', '.ghx'];

const IMAGE_CONTENT_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp'
};

const ALLOWED_IMAGE_EXTENSIONS = Object.keys(IMAGE_CONTENT_TYPES);

export class FilesystemDefinitionStore
	extends FilesystemDefinitionLoader
	implements IDefinitionStore {
	private readonly definitionsPath: string;

	constructor(definitionsPath: string) {
		super({ definitionsPath });
		this.definitionsPath = definitionsPath;
	}

	// ── Config helpers ──────────────────────────────────────────────────────

	async readConfig(): Promise<DefinitionsConfig> {
		const configPath = this.getConfigFilePath();
		try {
			const content = await fs.readFile(configPath, 'utf-8');
			return JSON.parse(content) as DefinitionsConfig;
		} catch {
			return { definitions: {} };
		}
	}

	private async writeConfig(config: DefinitionsConfig): Promise<void> {
		const configPath = this.getConfigFilePath();
		await fs.writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
		// Invalidate the loader cache immediately so subsequent reads see the new data
		this.configCache = undefined;
	}

	private getConfigFilePath(): string {
		return path.join(this.definitionsPath, 'definitions-config.json');
	}

	private guidPath(guid: string): string {
		return path.join(this.definitionsPath, guid);
	}

	// ── IDefinitionStore implementation ─────────────────────────────────────

	async getFileHistory(guid: string): Promise<string[]> {
		const oldFilesPath = path.join(this.guidPath(guid), 'old_files');
		try {
			const entries = await fs.readdir(oldFilesPath);
			return entries
				.filter((f) => f.endsWith('.gh') || f.endsWith('.ghx'))
				.sort()
				.reverse();
		} catch {
			return [];
		}
	}

	async createDefinition(
		input: CreateDefinitionInput,
		imageFile?: FileInput | null
	): Promise<{ guid: string; filename: string; coverImage?: string }> {
		const { file: ghFile, displayName, description, category, tags, coverImage: coverImageUrl } = input;

		const ext = path.extname(ghFile.name).toLowerCase();
		if (!GH_EXTENSIONS.includes(ext)) {
			throw new Error(`File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
		}

		const guid = randomUUID();
		const guidDir = this.guidPath(guid);
		await fs.mkdir(guidDir, { recursive: true });

		// Write GH file
		await fs.writeFile(path.join(guidDir, ghFile.name), Buffer.from(ghFile.data));

		// Optionally write image
		let coverImage: string | undefined;
		if (imageFile && imageFile.data.byteLength > 0) {
			coverImage = await this._writeImage(guid, imageFile);
		} else if (coverImageUrl) {
			coverImage = coverImageUrl;
		}

		// Update config
		const config = await this.readConfig();
		config.definitions[guid] = {
			displayName: displayName.trim(),
			...(description ? { description } : {}),
			...(category ? { category } : {}),
			...(tags && tags.length > 0 ? { tags } : {}),
			...(coverImage ? { coverImage } : {}),
			file: ghFile.name
		};
		await this.writeConfig(config);

		return { guid, filename: ghFile.name, coverImage };
	}

	async updateMetadata(guid: string, patch: Partial<DefinitionMetadata>): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new Error(`Definition '${guid}' not found`);

		// Preserve `file` field; merge everything else
		config.definitions[guid] = {
			...existing,
			...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
			...(patch.description !== undefined ? { description: patch.description } : {}),
			...(patch.category !== undefined ? { category: patch.category } : {}),
			...(patch.tags !== undefined ? { tags: patch.tags } : {}),
			...(patch.coverImage !== undefined ? { coverImage: patch.coverImage } : {})
		};
		await this.writeConfig(config);
	}

	async deleteDefinition(guid: string): Promise<void> {
		const config = await this.readConfig();
		if (config.definitions[guid]) {
			delete config.definitions[guid];
			await this.writeConfig(config);
		}
		await fs.rm(this.guidPath(guid), { recursive: true, force: true });
	}

	async replaceFile(guid: string, file: FileInput): Promise<string> {
		const ext = path.extname(file.name).toLowerCase();
		if (!GH_EXTENSIONS.includes(ext)) {
			throw new Error(`File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
		}

		const guidDir = this.guidPath(guid);
		const oldFilesDir = path.join(guidDir, 'old_files');
		const newFilePath = path.join(guidDir, file.name);

		await fs.mkdir(guidDir, { recursive: true });

		// Archive any existing GH file that differs from the incoming one
		try {
			const entries = await fs.readdir(guidDir);
			for (const entry of entries) {
				const entryExt = path.extname(entry).toLowerCase();
				if (entry !== 'old_files' && GH_EXTENSIONS.includes(entryExt)) {
					const existingPath = path.join(guidDir, entry);
					if (existingPath !== newFilePath) {
						await fs.mkdir(oldFilesDir, { recursive: true });
						const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
						const backupName = `${timestamp}_${entry}`;
						const data = await fs.readFile(existingPath);
						await fs.writeFile(path.join(oldFilesDir, backupName), data);
						await fs.unlink(existingPath);
						break;
					}
				}
			}
		} catch {
			// Non-fatal — proceed to write new file
		}

		await fs.writeFile(newFilePath, Buffer.from(file.data));

		// Update config
		const config = await this.readConfig();
		if (config.definitions[guid]) {
			config.definitions[guid].file = file.name;
			await this.writeConfig(config);
		}

		return file.name;
	}

	async saveImage(guid: string, image: FileInput): Promise<string> {
		const coverImage = await this._writeImage(guid, image);

		const config = await this.readConfig();
		if (!config.definitions[guid]) throw new Error(`Definition '${guid}' not found`);
		config.definitions[guid].coverImage = coverImage;
		await this.writeConfig(config);

		return coverImage;
	}

	async readImage(guid: string, filename: string): Promise<Buffer> {
		const filePath = path.join(this.guidPath(guid), filename);
		return fs.readFile(filePath);
	}

	// ── Private helpers ─────────────────────────────────────────────────────

	/** Write image bytes to the GUID folder, return the admin serve URL */
	private async _writeImage(guid: string, image: FileInput): Promise<string> {
		const ext = path.extname(image.name).toLowerCase();
		if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
			throw new Error(`Unsupported image type. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}`);
		}
		const safeFilename = image.name.replace(/[^a-zA-Z0-9._-]/g, '_');
		const filePath = path.join(this.guidPath(guid), safeFilename);
		await fs.writeFile(filePath, Buffer.from(image.data));
		return `/api/definitions/${guid}/image/${safeFilename}`;
	}
}
