import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FilesystemDefinitionLoader } from '../loaders/filesystem';
import { GH_EXTENSIONS, IMAGE_EXTENSIONS as ALLOWED_IMAGE_EXTENSIONS } from '../../admin-config';
import type {
	IDefinitionStore,
	DefinitionMetadata,
	DefinitionsConfig,
	FileInput,
	CreateDefinitionInput,
	HistoryEntry
} from '../types';

/** Regex for archived filenames: "2024-01-15T10-30-45-123Z_originalname.gh" */
const ARCHIVE_FILENAME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_(.+)$/;

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
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return { definitions: {} };
			}
			throw err;
		}
	}

	private async writeConfig(config: DefinitionsConfig): Promise<void> {
		const configPath = this.getConfigFilePath();
		const tmpPath = `${configPath}.tmp`;
		await fs.writeFile(tmpPath, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmpPath, configPath);
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

	async getFileHistory(guid: string): Promise<HistoryEntry[]> {
		const config = await this.readConfig();
		const def = config.definitions[guid];

		// If history is already tracked in config, return it (sorted newest first)
		if (def?.history !== undefined) {
			return [...def.history].sort((a, b) => b.date.localeCompare(a.date));
		}

		// Migration path: definition exists but has no history tracked yet
		// Scan old_files/, build history entries, save to config
		const entries = await this._buildHistoryFromFilesystem(guid);
		if (def && entries.length > 0) {
			def.history = entries;
			await this.writeConfig(config);
		}
		return entries;
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

		// Handle image - either from file upload or URL
		let coverImage: string | undefined;
		if (imageFile && imageFile.data.byteLength > 0) {
			coverImage = await this._writeImage(guid, imageFile);
		} else if (coverImageUrl) {
			coverImage = coverImageUrl;
		}

		// Update config - initialize all properties consistently
		const config = await this.readConfig();
		const newEntry: DefinitionMetadata & { file: string } = {
			displayName: displayName.trim(),
			file: ghFile.name,
			history: []
		};

		// Always add optional properties if they have values (even if just a space)
		if (description) newEntry.description = description;
		if (category) newEntry.category = category;
		if (tags && tags.length > 0) newEntry.tags = tags;
		// Always preserve coverImage if it exists (whether URL or file path)
		if (coverImage !== undefined) newEntry.coverImage = coverImage;

		config.definitions[guid] = newEntry;
		await this.writeConfig(config);

		return { guid, filename: ghFile.name, coverImage };
	}

	async updateMetadata(guid: string, patch: Partial<DefinitionMetadata>): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new Error(`Definition '${guid}' not found`);

		// Merge patch into existing, preserving all properties including file and history
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
			// empty string = explicit clear; non-empty string = set new value
			if (patch.coverImage) updated.coverImage = patch.coverImage;
			// else: leave updated.coverImage unset (clears it)
		} else if (existing.coverImage) {
			updated.coverImage = existing.coverImage;
		}

		// Preserve history (never patched via metadata update)
		if (existing.history !== undefined) {
			updated.history = existing.history;
		}

		// maxHistory: 0 is a valid value (keep all), so check !== undefined
		if (patch.maxHistory !== undefined) {
			if (patch.maxHistory > 0) updated.maxHistory = patch.maxHistory;
			// 0 = keep all = omit the field
		} else if (existing.maxHistory) {
			updated.maxHistory = existing.maxHistory;
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

		// Archive any existing GH file (including same-named replacements)
		let archivedEntry: HistoryEntry | null = null;
		try {
			const entries = await fs.readdir(guidDir);
			for (const entry of entries) {
				const entryExt = path.extname(entry).toLowerCase();
				if (entry !== 'old_files' && GH_EXTENSIONS.includes(entryExt)) {
					const existingPath = path.join(guidDir, entry);
					await fs.mkdir(oldFilesDir, { recursive: true });
					const now = new Date();
					const timestamp = now.toISOString().replace(/[:.]/g, '-');
					const backupName = `${timestamp}_${entry}`;
					const data = await fs.readFile(existingPath);
					await fs.writeFile(path.join(oldFilesDir, backupName), data);
					await fs.unlink(existingPath);
					archivedEntry = {
						filename: backupName,
						originalName: entry,
						date: now.toISOString()
					};
					break;
				}
			}
		} catch {
			// Non-fatal — proceed to write new file
		}

		await fs.writeFile(newFilePath, Buffer.from(file.data));

		// Update config: file pointer + history
		const config = await this.readConfig();
		if (config.definitions[guid]) {
			const def = config.definitions[guid];
			def.file = file.name;

			if (archivedEntry) {
				// Ensure history is populated (migrate from filesystem if needed)
				if (def.history === undefined) {
					def.history = await this._buildHistoryFromFilesystem(guid);
					// The file we just archived isn't on disk yet reflected, but we'll prepend below
				}
				def.history = [archivedEntry, ...def.history];

				// Prune if maxHistory is set
				if (def.maxHistory && def.maxHistory > 0) {
					def.history = await this._pruneHistory(oldFilesDir, def.history, def.maxHistory);
				}
			}

			await this.writeConfig(config);
		}

		return file.name;
	}

	async revertFile(guid: string, archivedFilename: string): Promise<string> {
		const oldFilesDir = path.join(this.guidPath(guid), 'old_files');
		const archivedPath = path.join(oldFilesDir, archivedFilename);

		// Validate the archived file actually exists and is a GH file
		const ext = path.extname(archivedFilename).toLowerCase();
		if (!GH_EXTENSIONS.includes(ext)) {
			throw new Error('Invalid archived file type');
		}

		const data = await fs.readFile(archivedPath);

		// Remove the reverted entry from history before replaceFile adds the current file
		const config = await this.readConfig();
		const def = config.definitions[guid];
		if (def?.history !== undefined) {
			def.history = def.history.filter((e) => e.filename !== archivedFilename);
			await this.writeConfig(config);
		}

		// Delete the archived file — replaceFile will archive the current active file
		await fs.unlink(archivedPath);

		// Strip timestamp prefix (format: "2024-01-15T10-30-45-123Z_originalname.gh")
		const originalName = archivedFilename.replace(/^[^_]+_/, '');

		// replaceFile archives the current file and writes the restored one
		return this.replaceFile(guid, { name: originalName, data: data.buffer });
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

	/** Parse a timestamped archived filename into a HistoryEntry. Returns null if unparseable. */
	private _parseHistoryEntry(filename: string): HistoryEntry | null {
		const match = filename.match(ARCHIVE_FILENAME_RE);
		if (!match) return null;
		const [, tsStr, originalName] = match;
		// Restore ISO format: "2024-01-15T10-30-45-123Z" → "2024-01-15T10:30:45.123Z"
		const isoStr = tsStr.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/, 'T$1:$2:$3.$4');
		const date = new Date(isoStr);
		return {
			filename,
			originalName,
			date: isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
		};
	}

	/** Scan old_files/ on disk and build a HistoryEntry list (newest first). */
	private async _buildHistoryFromFilesystem(guid: string): Promise<HistoryEntry[]> {
		const oldFilesDir = path.join(this.guidPath(guid), 'old_files');
		try {
			const files = await fs.readdir(oldFilesDir);
			const entries: HistoryEntry[] = [];
			for (const f of files) {
				if (!f.endsWith('.gh') && !f.endsWith('.ghx')) continue;
				const entry = this._parseHistoryEntry(f);
				if (entry) entries.push(entry);
			}
			return entries.sort((a, b) => b.date.localeCompare(a.date));
		} catch {
			return [];
		}
	}

	/**
	 * Prune history to maxHistory entries, deleting excess files from disk.
	 * Returns the kept entries (newest first).
	 */
	private async _pruneHistory(
		oldFilesDir: string,
		entries: HistoryEntry[],
		maxHistory: number
	): Promise<HistoryEntry[]> {
		const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
		if (sorted.length <= maxHistory) return sorted;

		const keep = sorted.slice(0, maxHistory);
		const remove = sorted.slice(maxHistory);

		for (const entry of remove) {
			try {
				await fs.unlink(path.join(oldFilesDir, entry.filename));
			} catch {
				// Non-fatal — file may already be gone
			}
		}

		return keep;
	}

	/** Write image bytes to the GUID folder, return the admin serve URL */
	private async _writeImage(guid: string, image: FileInput): Promise<string> {
		const ext = path.extname(image.name).toLowerCase();
		if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
			throw new Error(`Unsupported image type. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}`);
		}

		// Write new image first, then remove old ones — avoids data loss if write fails
		const guidDir = this.guidPath(guid);
		await fs.mkdir(guidDir, { recursive: true });

		const safeFilename = image.name.replace(/[^a-zA-Z0-9._-]/g, '_');
		const filePath = path.join(guidDir, safeFilename);
		await fs.writeFile(filePath, Buffer.from(image.data));

		try {
			const entries = await fs.readdir(guidDir);
			for (const entry of entries) {
				if (entry !== safeFilename && ALLOWED_IMAGE_EXTENSIONS.includes(path.extname(entry).toLowerCase())) {
					await fs.rm(path.join(guidDir, entry), { force: true });
				}
			}
		} catch {
			// Non-fatal — old image cleanup is best-effort
		}

		return `/admin/api/definitions/${guid}/image/${safeFilename}`;
	}
}
