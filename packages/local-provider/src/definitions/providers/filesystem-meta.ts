import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	IDefinitionMetaProvider,
	DefinitionRecord,
	DefinitionRecordPatch,
	HistoryEntry
} from '@selva/platform/definitions';
import { ProviderError } from '@selva/platform';

interface DefinitionsConfig {
	definitions: Record<string, DefinitionRecord>;
}

export class LocalDefinitionMetaProvider implements IDefinitionMetaProvider {
	private readonly configPath: string;

	static fromEnv(env: Record<string, string | undefined>): LocalDefinitionMetaProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalDefinitionMetaProvider(env.DATA_PATH);
	}

	constructor(definitionsPath: string) {
		this.configPath = path.join(definitionsPath, 'definitions-config.json');
	}

	// ── Config helpers ──────────────────────────────────────────────────────────

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
		await fs.mkdir(path.dirname(this.configPath), { recursive: true });
		const tmpPath = `${this.configPath}.tmp`;
		await fs.writeFile(tmpPath, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmpPath, this.configPath);
	}

	// ── IDefinitionMetaProvider ─────────────────────────────────────────────────

	async list(): Promise<DefinitionRecord[]> {
		const config = await this.readConfig();
		const records = Object.values(config.definitions).filter((r) => r?.meta?.displayName);
		records.sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));
		return records;
	}

	async listByProject(projectId: string): Promise<DefinitionRecord[]> {
		const all = await this.list();
		return all.filter((r) => r.projectId === projectId);
	}

	async listPublic(): Promise<DefinitionRecord[]> {
		return this.list();
	}

	async get(guid: string): Promise<DefinitionRecord | null> {
		const config = await this.readConfig();
		return config.definitions[guid] ?? null;
	}

	async create(record: DefinitionRecord): Promise<void> {
		const config = await this.readConfig();
		config.definitions[record.guid] = record;
		await this.writeConfig(config);
	}

	async update(guid: string, patch: DefinitionRecordPatch): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new ProviderError(`Definition '${guid}' not found`, 404);

		config.definitions[guid] = {
			...existing,
			...(patch.fileExt !== undefined && { fileExt: patch.fileExt }),
			...(patch.maxHistory !== undefined && { maxHistory: patch.maxHistory }),
			...(patch.projectId !== undefined && { projectId: patch.projectId }),
			...(patch.computeServerId !== undefined && {
				computeServerId: patch.computeServerId ?? undefined
			}),
			meta: patch.meta ? { ...existing.meta, ...patch.meta } : existing.meta,
			updatedAt: new Date().toISOString()
		};
		await this.writeConfig(config);
	}

	async addHistoryEntry(guid: string, entry: HistoryEntry): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new ProviderError(`Definition '${guid}' not found`, 404);

		const history = [entry, ...existing.history];

		if (existing.maxHistory > 0) {
			existing.history = history.slice(0, existing.maxHistory);
		} else {
			existing.history = history;
		}

		await this.writeConfig(config);
	}

	async removeHistoryEntry(guid: string, ref: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new ProviderError(`Definition '${guid}' not found`, 404);

		existing.history = existing.history.filter((e) => e.ref !== ref);
		await this.writeConfig(config);
	}

	async delete(guid: string): Promise<void> {
		const config = await this.readConfig();
		delete config.definitions[guid];
		await this.writeConfig(config);
	}
}
