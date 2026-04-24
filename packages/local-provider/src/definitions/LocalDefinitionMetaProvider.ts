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
			// Audit-field backfill (B3): older records predate createdBy/updatedBy.
			// `lastEditedBy` was the old optional field; fall back to ownerId.
			const legacy = record as DefinitionRecord & { lastEditedBy?: string };
			if (!record.createdBy) record.createdBy = record.ownerId;
			if (!record.updatedBy) record.updatedBy = legacy.lastEditedBy ?? record.ownerId;
			if (legacy.lastEditedBy !== undefined) delete legacy.lastEditedBy;
			if (record.deletedAt === undefined) record.deletedAt = null;
			for (const entry of record.history ?? []) {
				if (!entry.uploadedBy) entry.uploadedBy = record.ownerId;
			}
		}
		return parsed;
	}

	/** Data-access-layer filter: live (non-soft-deleted) only. */
	private live(record: DefinitionRecord | undefined | null): record is DefinitionRecord {
		return Boolean(record && record.deletedAt == null);
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
			if (field === 'name') return r.displayName.toLowerCase();
			if (field === 'runCount') return r.runCount ?? 0;
			return (r as unknown as Record<string, unknown>)[field];
		});
	}

	private visibleRecords(records: DefinitionRecord[], opts?: DefinitionListOptions): DefinitionRecord[] {
		// Always drop soft-deleted rows before any other filter.
		const filtered = records.filter((r) => r?.displayName && this.live(r));
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

	async listPublic(
		ctx: RequestContext,
		opts?: DefinitionListOptions & { orgId?: string }
	): Promise<Page<DefinitionRecord>> {
		if (!this.projectProvider) {
			// Pre-wiring fallback: behave as if the default project is public, which
			// matches the local bootstrap. Once setProjectProvider is called this
			// branch stops executing.
			return this.list(ctx, opts);
		}

		const config = await this.readConfig();
		const records = Object.values(config.definitions).filter((r): r is DefinitionRecord =>
			Boolean(r?.displayName && this.live(r))
		);

		// Resolve each record's project once, in bulk — one getProject call per
		// unique projectId. Cheap for local scale (single file read behind the scenes).
		const projectIds = Array.from(new Set(records.map((r) => r.projectId)));
		const projects = await Promise.all(
			projectIds.map((id) => this.projectProvider!.getProject(ctx, id))
		);
		const publicProjectIds = new Set(
			projects
				.filter(
					(p): p is NonNullable<typeof p> =>
						p !== null && p.visibility === 'public' && (!opts?.orgId || p.orgId === opts.orgId)
				)
				.map((p) => p.id)
		);

		const publicRecords = this.visibleRecords(
			records.filter((r) => publicProjectIds.has(r.projectId)),
			opts
		);
		return paginate(this.sortedRecords(publicRecords, opts), opts);
	}

	async get(_ctx: RequestContext, guid: string): Promise<DefinitionRecord | null> {
		const config = await this.readConfig();
		const r = config.definitions[guid];
		return this.live(r) ? r : null;
	}

	async create(ctx: RequestContext, record: DefinitionRecord): Promise<void> {
		const config = await this.readConfig();
		const actor = ctx.userId || record.ownerId;
		config.definitions[record.guid] = {
			...record,
			createdBy: record.createdBy || actor,
			updatedBy: record.updatedBy || actor,
			deletedAt: null
		};
		await this.writeConfig(config);
	}

	async update(ctx: RequestContext, guid: string, patch: DefinitionRecordPatch): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) throw new ProviderError(`Definition '${guid}' not found`, 404);

		// `null` clears the field (sets to undefined); `undefined` leaves unchanged.
		const clearable = (v: unknown) => (v === null ? undefined : v);
		config.definitions[guid] = {
			...existing,
			...(patch.displayName !== undefined && { displayName: patch.displayName }),
			...(patch.description !== undefined && { description: clearable(patch.description) as string | undefined }),
			...(patch.category !== undefined && { category: clearable(patch.category) as string | undefined }),
			...(patch.tags !== undefined && { tags: clearable(patch.tags) as string[] | undefined }),
			...(patch.coverImage !== undefined && { coverImage: clearable(patch.coverImage) as string | undefined }),
			...(patch.fileExt !== undefined && { fileExt: patch.fileExt }),
			...(patch.originalFilename !== undefined && { originalFilename: patch.originalFilename }),
			...(patch.maxHistory !== undefined && { maxHistory: patch.maxHistory }),
			...(patch.projectId !== undefined && { projectId: patch.projectId }),
			...(patch.computeServerId !== undefined && {
				computeServerId: clearable(patch.computeServerId) as string | undefined
			}),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.ownerId !== undefined && { ownerId: patch.ownerId }),
			updatedAt: new Date().toISOString(),
			updatedBy: ctx.userId || existing.updatedBy
		};
		await this.writeConfig(config);
	}

	async addHistoryEntry(ctx: RequestContext, guid: string, entry: HistoryEntry): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) throw new ProviderError(`Definition '${guid}' not found`, 404);

		const history = [entry, ...existing.history];
		existing.history = existing.maxHistory > 0 ? history.slice(0, existing.maxHistory) : history;
		existing.updatedAt = new Date().toISOString();
		existing.updatedBy = ctx.userId || existing.updatedBy;
		await this.writeConfig(config);
	}

	async removeHistoryEntry(ctx: RequestContext, guid: string, ref: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) throw new ProviderError(`Definition '${guid}' not found`, 404);

		existing.history = existing.history.filter((e) => e.ref !== ref);
		existing.updatedAt = new Date().toISOString();
		existing.updatedBy = ctx.userId || existing.updatedBy;
		await this.writeConfig(config);
	}

	async delete(ctx: RequestContext, guid: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) return;
		const now = new Date().toISOString();
		existing.deletedAt = now;
		existing.updatedAt = now;
		existing.updatedBy = ctx.userId || existing.updatedBy;
		await this.writeConfig(config);
	}

	async incrementRunCount(_ctx: RequestContext, guid: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) return;
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
			(r) =>
				this.live(r) && r.status === ('pending' as string) && r.createdAt <= olderThanIso
		);
	}

	async canEditDefinition(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		definitionOwnerId: string
	): Promise<boolean> {
		if (!this.projectProvider) return false;
		if (hasPermission(ctx, 'instance_admin')) return true;

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
