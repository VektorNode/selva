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

		// Update config - initialize all properties with proper defaults
		const config = await this.readConfig();
		const newEntry: DefinitionMetadata & { file: string } = {
			displayName: displayName.trim(),
			file: ghFile.name
		};

		if (description) newEntry.description = description;
		if (category) newEntry.category = category;
		if (tags && tags.length > 0) newEntry.tags = tags;
		if (coverImage) newEntry.coverImage = coverImage;

		config.definitions[guid] = newEntry;
		await this.writeConfig(config);

		return { guid, filename: ghFile.name, coverImage };
	}

	async updateMetadata(guid: string, patch: Partial<DefinitionMetadata>): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new Error(`Definition '${guid}' not found`);

		// Merge patch into existing, preserving all properties including file
		const updated = {
			displayName: patch.displayName ?? existing.displayName,
			file: existing.file || ''
		} as DefinitionMetadata & { file: string };

		// Only include optional properties if they have values
		if (patch.description !== undefined) {
			if (patch.description) updated.description = patch.description;
		} else if (existing.description) {
			updated.description = existing.description;
		}

		if (patch.category !== undefined) {
			if (patch.category) updated.category = patch.category;
		} else if (existing.category) {
			updated.category = existing.category;
		}

		if (patch.tags !== undefined) {
			if (patch.tags && patch.tags.length > 0) updated.tags = patch.tags;
		} else if (existing.tags) {
			updated.tags = existing.tags;
		}

		if (patch.coverImage !== undefined) {
			if (patch.coverImage) updated.coverImage = patch.coverImage;
		} else if (existing.coverImage) {
			updated.coverImage = existing.coverImage;
		}

		config.definitions[guid] = updated;
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
