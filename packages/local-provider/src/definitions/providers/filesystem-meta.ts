import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	IDefinitionMetaProvider,
	DefinitionRecord,
	DefinitionMeta,
	DefinitionFileExt,
	HistoryEntry
} from '@selva/platform/definitions';

// Shape of definitions-config.json on disk
interface StoredHistoryEntry {
	filename: string;
	originalName: string;
	date: string;
}

interface StoredDefinitionMetadata {
	displayName: string;
	description?: string;
	coverImage?: string;
	category?: string;
	tags?: string[];
	originalFilename?: string;
	file?: string;
	history?: StoredHistoryEntry[];
	maxHistory?: number;
}

interface DefinitionsConfig {
	definitions: Record<string, StoredDefinitionMetadata>;
}

// Normalize admin image URLs to public URLs
function normalizeCoverImage(url?: string): string | undefined {
	if (!url?.startsWith('/admin/api/definitions/')) return url;
	const match = url.match(/\/admin\/api\/definitions\/(.+?)\/(image\/.+)/);
	if (match) return `/api/definitions/${match[1]}/${match[2]}`;
	return url;
}

// Map stored history entry (legacy filename/date fields) to platform HistoryEntry (ref/archivedAt)
function toHistoryEntry(stored: StoredHistoryEntry): HistoryEntry {
	return {
		ref: stored.filename,
		originalName: stored.originalName,
		archivedAt: stored.date
	};
}

// Map platform HistoryEntry back to stored shape
function toStoredHistoryEntry(entry: HistoryEntry): StoredHistoryEntry {
	return {
		filename: entry.ref,
		originalName: entry.originalName,
		date: entry.archivedAt
	};
}

function deriveFileExt(file?: string): DefinitionFileExt {
	if (file?.endsWith('.ghx')) return 'ghx';
	return 'gh';
}

function toDefinitionRecord(guid: string, stored: StoredDefinitionMetadata): DefinitionRecord {
	const history = (stored.history ?? []).map(toHistoryEntry);
	// Sort newest first
	history.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));

	return {
		guid,
		fileExt: deriveFileExt(stored.file),
		meta: {
			displayName: stored.displayName,
			description: stored.description,
			coverImage: normalizeCoverImage(stored.coverImage),
			category: stored.category,
			tags: stored.tags,
			originalFilename: stored.originalFilename
		},
		history,
		maxHistory: stored.maxHistory ?? 0,
		createdAt: new Date(0).toISOString(), // not stored in legacy format
		updatedAt: new Date(0).toISOString()
	};
}

export class LocalDefinitionMetaProvider implements IDefinitionMetaProvider {
	private readonly configPath: string;

	constructor(definitionsPath: string) {
		this.configPath = path.join(definitionsPath, 'definitions-config.json');
	}

	// ── Config helpers ──────────────────────────────────────────────────────

	private async readConfig(): Promise<DefinitionsConfig> {
		try {
			const content = await fs.readFile(this.configPath, 'utf-8');
			return JSON.parse(content) as DefinitionsConfig;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return { definitions: {} };
			}
			throw err;
		}
	}

	private async writeConfig(config: DefinitionsConfig): Promise<void> {
		const tmpPath = `${this.configPath}.tmp`;
		await fs.writeFile(tmpPath, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmpPath, this.configPath);
	}

	// ── IDefinitionMetaProvider ─────────────────────────────────────────────

	async list(): Promise<DefinitionRecord[]> {
		const config = await this.readConfig();
		const records: DefinitionRecord[] = [];

		for (const [guid, stored] of Object.entries(config.definitions)) {
			if (!stored.displayName) continue;
			records.push(toDefinitionRecord(guid, stored));
		}

		records.sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));
		return records;
	}

	async get(guid: string): Promise<DefinitionRecord | null> {
		const config = await this.readConfig();
		const stored = config.definitions[guid];
		if (!stored) return null;
		return toDefinitionRecord(guid, stored);
	}

	async create(record: DefinitionRecord): Promise<void> {
		const config = await this.readConfig();

		const entry: StoredDefinitionMetadata = {
			displayName: record.meta.displayName,
			file: `definition.${record.fileExt}`,
			originalFilename: record.meta.originalFilename,
			history: []
		};

		if (record.meta.description) entry.description = record.meta.description;
		if (record.meta.category) entry.category = record.meta.category;
		if (record.meta.tags && record.meta.tags.length > 0) entry.tags = record.meta.tags;
		if (record.meta.coverImage) entry.coverImage = record.meta.coverImage;
		if (record.maxHistory > 0) entry.maxHistory = record.maxHistory;

		config.definitions[record.guid] = entry;
		await this.writeConfig(config);
	}

	async update(guid: string, patch: Partial<DefinitionMeta>): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new Error(`Definition '${guid}' not found`);

		const updated: StoredDefinitionMetadata = {
			displayName: patch.displayName ?? existing.displayName,
			file: existing.file || ''
		};

		if (existing.originalFilename) updated.originalFilename = existing.originalFilename;

		// String fields: patch overrides if provided; preserve existing otherwise
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

		if (existing.history !== undefined) updated.history = existing.history;
		if (existing.maxHistory !== undefined) updated.maxHistory = existing.maxHistory;

		config.definitions[guid] = updated;
		await this.writeConfig(config);
	}

	async addHistoryEntry(guid: string, entry: HistoryEntry): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new Error(`Definition '${guid}' not found`);

		const storedEntry = toStoredHistoryEntry(entry);
		const history = [storedEntry, ...(existing.history ?? [])];

		// Prune if maxHistory set — caller is responsible for deleting archived files
		if (existing.maxHistory && existing.maxHistory > 0) {
			existing.history = history.slice(0, existing.maxHistory);
		} else {
			existing.history = history;
		}

		// Update originalFilename to reflect the new file being uploaded
		// (caller should also update this via update() if needed)
		config.definitions[guid] = existing;
		await this.writeConfig(config);
	}

	async removeHistoryEntry(guid: string, ref: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new Error(`Definition '${guid}' not found`);

		existing.history = (existing.history ?? []).filter((e) => e.filename !== ref);
		config.definitions[guid] = existing;
		await this.writeConfig(config);
	}

	async delete(guid: string): Promise<void> {
		const config = await this.readConfig();
		delete config.definitions[guid];
		await this.writeConfig(config);
	}
}
