import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	IDefinitionStore,
	DefinitionRecord,
	DefinitionRecordPatch,
	HistoryEntry,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
import { paginate } from '../pagination.js';

interface DefinitionsConfig {
	definitions: Record<string, DefinitionRecord>;
}

export class LocalDefinitionMetaProvider implements IDefinitionStore {
	private readonly configPath: string;

	static fromEnv(env: Record<string, string | undefined>): LocalDefinitionMetaProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalDefinitionMetaProvider(env.DATA_PATH);
	}

	constructor(definitionsPath: string) {
		this.configPath = path.join(definitionsPath, 'definitions-config.json');
	}

	private async readConfig(): Promise<DefinitionsConfig> {
		try {
			const content = await fs.readFile(this.configPath, 'utf-8');
			const parsed = JSON.parse(content) as DefinitionsConfig;
			// Backfill status for records written before Phase 4 landed.
			// Anything on disk is by definition fully written, so treat as 'ready'.
			for (const record of Object.values(parsed.definitions)) {
				if (record && !record.status) record.status = 'ready';
			}
			return parsed;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { definitions: {} };
			throw err;
		}
	}

	private async writeConfig(config: DefinitionsConfig): Promise<void> {
		await fs.mkdir(path.dirname(this.configPath), { recursive: true });
		const tmpPath = `${this.configPath}.tmp`;
		await fs.writeFile(tmpPath, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmpPath, this.configPath);
	}

	private sortedRecords(records: DefinitionRecord[], opts?: ListOptions): DefinitionRecord[] {
		const field = opts?.orderBy ?? 'name';
		const dir = opts?.orderDir ?? 'asc';
		const mul = dir === 'asc' ? 1 : -1;
		return [...records].sort((a, b) => {
			if (field === 'name') {
				return a.meta.displayName.localeCompare(b.meta.displayName) * mul;
			}
			const av = (a as unknown as Record<string, string>)[field] ?? '';
			const bv = (b as unknown as Record<string, string>)[field] ?? '';
			if (av < bv) return -1 * mul;
			if (av > bv) return 1 * mul;
			return 0;
		});
	}

	/** Apply the default 'ready' filter, respecting ListOptions.includePending. */
	private visibleRecords(records: DefinitionRecord[], opts?: ListOptions): DefinitionRecord[] {
		const filtered = records.filter((r) => r?.meta?.displayName);
		if (opts?.includePending) return filtered;
		return filtered.filter((r) => r.status === 'ready');
	}

	async list(_ctx: RequestContext, opts?: ListOptions): Promise<Page<DefinitionRecord>> {
		const config = await this.readConfig();
		const records = this.visibleRecords(Object.values(config.definitions), opts);
		return paginate(this.sortedRecords(records, opts), opts);
	}

	async listByProject(
		_ctx: RequestContext,
		projectId: string,
		opts?: ListOptions
	): Promise<Page<DefinitionRecord>> {
		const config = await this.readConfig();
		const records = this.visibleRecords(
			Object.values(config.definitions).filter((r) => r?.projectId === projectId),
			opts
		);
		return paginate(this.sortedRecords(records, opts), opts);
	}

	async listPublic(ctx: RequestContext, opts?: ListOptions): Promise<Page<DefinitionRecord>> {
		return this.list(ctx, opts);
	}

	async get(_ctx: RequestContext, guid: string): Promise<DefinitionRecord | null> {
		const config = await this.readConfig();
		return config.definitions[guid] ?? null;
	}

	async create(_ctx: RequestContext, record: DefinitionRecord): Promise<void> {
		const config = await this.readConfig();
		config.definitions[record.guid] = record;
		await this.writeConfig(config);
	}

	async update(_ctx: RequestContext, guid: string, patch: DefinitionRecordPatch): Promise<void> {
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
			...(patch.status !== undefined && { status: patch.status }),
			meta: patch.meta ? { ...existing.meta, ...patch.meta } : existing.meta,
			updatedAt: new Date().toISOString()
		};
		await this.writeConfig(config);
	}

	async addHistoryEntry(_ctx: RequestContext, guid: string, entry: HistoryEntry): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new ProviderError(`Definition '${guid}' not found`, 404);

		const history = [entry, ...existing.history];
		existing.history = existing.maxHistory > 0 ? history.slice(0, existing.maxHistory) : history;
		await this.writeConfig(config);
	}

	async removeHistoryEntry(_ctx: RequestContext, guid: string, ref: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) throw new ProviderError(`Definition '${guid}' not found`, 404);

		existing.history = existing.history.filter((e) => e.ref !== ref);
		await this.writeConfig(config);
	}

	async delete(_ctx: RequestContext, guid: string): Promise<void> {
		const config = await this.readConfig();
		delete config.definitions[guid];
		await this.writeConfig(config);
	}

	async listStalePending(
		_ctx: RequestContext,
		olderThanIso: string
	): Promise<DefinitionRecord[]> {
		const config = await this.readConfig();
		return Object.values(config.definitions).filter(
			(r) => r?.status === 'pending' && r.createdAt <= olderThanIso
		);
	}
}
