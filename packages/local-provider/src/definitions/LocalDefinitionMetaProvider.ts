import * as path from 'node:path';
import type {
	IDefinitionStore,
	IProjectStore,
	DefinitionRecord,
	DefinitionRecordPatch,
	HistoryEntry,
	RequestContext,
	DefinitionListOptions,
	Page
} from '@selva/platform';
import { ProviderError, hasPermission } from '@selva/platform';
import { paginate, applyOrder } from '../pagination.js';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

interface DefinitionsConfig {
	definitions: Record<string, DefinitionRecord>;
}

export class LocalDefinitionMetaProvider implements IDefinitionStore {
	private readonly configPath: string;
	private projectProvider?: IProjectStore;

	static fromEnv(env: Record<string, string | undefined>): LocalDefinitionMetaProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalDefinitionMetaProvider(env.DATA_PATH);
	}

	constructor(definitionsPath: string, projectProvider?: IProjectStore) {
		this.configPath = path.join(definitionsPath, 'definitions-config.json');
		this.projectProvider = projectProvider;
	}

	setProjectProvider(projectProvider: IProjectStore): void {
		this.projectProvider = projectProvider;
	}

	private async readConfig(): Promise<DefinitionsConfig> {
		const parsed = await readJsonFile<DefinitionsConfig>(this.configPath, { definitions: {} });
		// Backfill fields for records written before schema migrations.
		for (const record of Object.values(parsed.definitions)) {
			if (!record) continue;
			// Records that pre-date the editorial workflow: treat as published.
			if (!record.status || record.status === ('ready' as string)) record.status = 'published';
			if (record.runCount === undefined) record.runCount = 0;
			for (const entry of record.history ?? []) {
				if (!entry.uploadedBy) entry.uploadedBy = record.ownerId;
			}
		}
		return parsed;
	}

	private async writeConfig(config: DefinitionsConfig): Promise<void> {
		await writeJsonFile(this.configPath, config);
	}

	private sortedRecords(records: DefinitionRecord[], opts?: DefinitionListOptions): DefinitionRecord[] {
		const defaulted: DefinitionListOptions = {
			...opts,
			orderBy: opts?.orderBy ?? 'name',
			orderDir: opts?.orderDir ?? 'asc'
		};
		return applyOrder([...records], defaulted, (r, field) => {
			if (field === 'name') return r.meta.displayName.toLowerCase();
			if (field === 'runCount') return r.runCount ?? 0;
			return (r as unknown as Record<string, unknown>)[field];
		});
	}

	private visibleRecords(records: DefinitionRecord[], opts?: DefinitionListOptions): DefinitionRecord[] {
		const filtered = records.filter((r) => r?.meta?.displayName);
		// Apply status filter
		if (opts?.statuses?.length) {
			const allowed = new Set(opts.statuses);
			return filtered.filter((r) => allowed.has(r.status));
		}
		if (opts?.includePending) return filtered;
		// Default: everything except internal 'pending' state
		return filtered.filter((r) => r.status !== 'pending');
	}

	async list(_ctx: RequestContext, opts?: DefinitionListOptions): Promise<Page<DefinitionRecord>> {
		const config = await this.readConfig();
		const records = this.visibleRecords(Object.values(config.definitions), opts);
		return paginate(this.sortedRecords(records, opts), opts);
	}

	async listByProject(
		_ctx: RequestContext,
		projectId: string,
		opts?: DefinitionListOptions
	): Promise<Page<DefinitionRecord>> {
		const config = await this.readConfig();
		const records = this.visibleRecords(
			Object.values(config.definitions).filter((r) => r?.projectId === projectId),
			opts
		);
		return paginate(this.sortedRecords(records, opts), opts);
	}

	async listPublic(ctx: RequestContext, opts?: DefinitionListOptions): Promise<Page<DefinitionRecord>> {
		// In local mode the default project is always 'public', so all ready
		// definitions are publicly visible. A cloud adapter would join on project
		// visibility and filter to 'public' projects only.
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
			...(patch.originalFilename !== undefined && { originalFilename: patch.originalFilename }),
			...(patch.maxHistory !== undefined && { maxHistory: patch.maxHistory }),
			...(patch.projectId !== undefined && { projectId: patch.projectId }),
			...(patch.computeServerId !== undefined && {
				computeServerId: patch.computeServerId ?? undefined
			}),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.lastEditedBy !== undefined && { lastEditedBy: patch.lastEditedBy }),
			...(patch.incrementRunCount !== undefined && {
				runCount: (existing.runCount ?? 0) + patch.incrementRunCount
			}),
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

	async incrementRunCount(_ctx: RequestContext, guid: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!existing) return;
		existing.runCount = (existing.runCount ?? 0) + 1;
		existing.updatedAt = new Date().toISOString();
		await this.writeConfig(config);
	}

	async listStalePending(
		_ctx: RequestContext,
		olderThanIso: string
	): Promise<DefinitionRecord[]> {
		const config = await this.readConfig();
		return Object.values(config.definitions).filter(
			(r) => r?.status === ('pending' as string) && r.createdAt <= olderThanIso
		);
	}

	async canEditDefinition(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		definitionOwnerId: string
	): Promise<boolean> {
		if (!this.projectProvider) return false;
		if (hasPermission(ctx.permissions, 'platform_admin')) return true;

		const project = await this.projectProvider.getProject(ctx, projectId);
		if (!project) return false;

		const projectMembers = await this.projectProvider.listProjectMembers(ctx, projectId);
		const member = projectMembers.items.find((m) => m.userId === userId);

		if (project.visibility === 'public') return userId === definitionOwnerId;
		if (project.visibility === 'org') {
			return userId === definitionOwnerId || member?.role === 'owner' || member?.role === 'editor';
		}
		if (project.visibility === 'private') {
			return member?.role === 'owner' || member?.role === 'editor';
		}
		return false;
	}
}
