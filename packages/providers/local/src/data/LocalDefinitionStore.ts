import * as path from 'node:path';
import type {
	IDefinitionStore,
	IProjectStore,
	IEventSink,
	DefinitionRecord,
	DefinitionRecordPatch,
	DefinitionVersion,
	RequestContext,
	DefinitionListOptions,
	ListOptions,
	Page,
	UISchema
} from '@selvajs/platform';
import {
	ProviderError,
	auditUpdate,
	auditSoftDelete,
	actorFrom,
	NoopEventSink
} from '@selvajs/platform';
import { paginate, applyOrder } from './pagination.js';
import { readJsonFile, writeJsonFile } from './fsJson.js';

interface DefinitionsConfig {
	definitions: Record<string, DefinitionRecord>;
	definitionVersions: Record<string, DefinitionVersion>;
}

/** Always return a fresh object — `readJsonFile` returns its fallback by
 * reference when the file is missing, so a shared singleton would let one
 * read pollute the next. */
const empty = (): DefinitionsConfig => ({ definitions: {}, definitionVersions: {} });

export class LocalDefinitionStore implements IDefinitionStore {
	private readonly configPath: string;
	private readonly events: IEventSink;
	private projectProvider?: IProjectStore;

	// Load-once write-through cache — same idiom as `LocalOrgStoreLoader` and the
	// auth/user-data stores. `definitions-config.json` is the largest and
	// fastest-growing local doc, re-read on every get/list/getVersion/listVersions,
	// including the unauthenticated share-link solve path (via the injected
	// definition provider in `LocalShareLinkStore`). Sole-writer in single-process
	// local mode → the in-memory copy is authoritative; every mutation reads the
	// cached object, mutates it, and `writeConfig` persists via temp+rename. This
	// store is constructed once per provider (and the share-link store gets the
	// SAME instance injected), so there's exactly one cache over the file. §3b.
	private cache: DefinitionsConfig | null = null;
	private loading: Promise<DefinitionsConfig> | null = null;

	static fromEnv(env: Record<string, string | undefined>): LocalDefinitionStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalDefinitionStore(env.DATA_PATH);
	}

	constructor(
		definitionsPath: string,
		projectProvider?: IProjectStore,
		events: IEventSink = new NoopEventSink()
	) {
		this.configPath = path.join(definitionsPath, 'definitions-config.json');
		this.projectProvider = projectProvider;
		this.events = events;
	}

	setProjectProvider(projectProvider: IProjectStore): void {
		this.projectProvider = projectProvider;
	}

	private async readConfig(): Promise<DefinitionsConfig> {
		if (this.cache) return this.cache;
		this.loading ??= readJsonFile<DefinitionsConfig>(this.configPath, empty()).then((data) => {
			this.cache = data;
			this.loading = null;
			return data;
		});
		return this.loading;
	}

	private live(record: DefinitionRecord | undefined | null): record is DefinitionRecord {
		return Boolean(record && record.deletedAt == null);
	}

	private async writeConfig(config: DefinitionsConfig): Promise<void> {
		this.cache = config;
		await writeJsonFile(this.configPath, config);
	}

	private sortedRecords(
		records: DefinitionRecord[],
		opts?: DefinitionListOptions
	): DefinitionRecord[] {
		const defaulted: DefinitionListOptions = {
			...opts,
			orderBy: opts?.orderBy ?? 'name',
			orderDir: opts?.orderDir ?? 'asc'
		};
		return applyOrder([...records], defaulted, (r, field) => {
			if (field === 'name') return r.displayName.toLowerCase();
			if (field === 'solveCount') return r.solveCount ?? 0;
			return (r as unknown as Record<string, unknown>)[field];
		});
	}

	private visibleRecords(
		records: DefinitionRecord[],
		opts?: DefinitionListOptions
	): DefinitionRecord[] {
		const filtered = records.filter((r) => r?.displayName && this.live(r));
		if (opts?.statuses?.length) {
			const allowed = new Set(opts.statuses);
			return filtered.filter((r) => allowed.has(r.status));
		}
		return filtered.filter((r) => {
			if (r.status === 'pending' && !opts?.includePending) return false;
			if (r.status === 'archived' && !opts?.includeArchived) return false;
			return true;
		});
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
			liveVersionId: record.liveVersionId ?? null,
			draftVersionId: record.draftVersionId ?? null,
			deletedAt: null
		};
		await this.writeConfig(config);
		await this.events.emit({
			type: 'definition.created',
			definitionId: record.guid,
			projectId: record.projectId,
			actorId: actorFrom(ctx)
		});
	}

	async update(ctx: RequestContext, guid: string, patch: DefinitionRecordPatch): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) throw new ProviderError(`Definition '${guid}' not found`, 404);

		const clearable = (v: unknown) => (v === null ? undefined : v);
		config.definitions[guid] = {
			...existing,
			...(patch.displayName !== undefined && { displayName: patch.displayName }),
			...(patch.description !== undefined && {
				description: clearable(patch.description) as string | undefined
			}),
			...(patch.category !== undefined && {
				category: clearable(patch.category) as string | undefined
			}),
			...(patch.tags !== undefined && { tags: clearable(patch.tags) as string[] | undefined }),
			...(patch.coverImage !== undefined && {
				coverImage: clearable(patch.coverImage) as string | undefined
			}),
			...(patch.projectId !== undefined && { projectId: patch.projectId }),
			...(patch.computeServerId !== undefined && {
				computeServerId: clearable(patch.computeServerId) as string | undefined
			}),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.ownerId !== undefined && { ownerId: patch.ownerId }),
			...auditUpdate(ctx, existing.updatedBy ?? existing.ownerId)
		};
		await this.writeConfig(config);
	}

	async delete(ctx: RequestContext, guid: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) return;
		Object.assign(existing, auditSoftDelete(ctx, existing.updatedBy ?? existing.ownerId));
		await this.writeConfig(config);
		await this.events.emit({
			type: 'definition.deleted',
			definitionId: guid,
			actorId: actorFrom(ctx)
		});
	}

	async deleteByProject(ctx: RequestContext, projectId: string): Promise<void> {
		const config = await this.readConfig();
		// One read-modify-write pass over the cached config so the whole cascade
		// lands in a single `writeConfig`. Collect the affected guids first, then
		// emit one `definition.deleted` per tombstoned record after the write.
		const affected: DefinitionRecord[] = [];
		for (const record of Object.values(config.definitions)) {
			if (record.projectId === projectId && this.live(record)) {
				Object.assign(record, auditSoftDelete(ctx, record.updatedBy ?? record.ownerId));
				affected.push(record);
			}
		}
		if (affected.length === 0) return;
		await this.writeConfig(config);
		for (const record of affected) {
			await this.events.emit({
				type: 'definition.deleted',
				definitionId: record.guid,
				actorId: actorFrom(ctx)
			});
		}
	}

	async incrementSolveCount(_ctx: RequestContext, guid: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) return;
		existing.solveCount = (existing.solveCount ?? 0) + 1;
		existing.updatedAt = new Date().toISOString();
		await this.writeConfig(config);
	}

	// ============================================================================
	// Versions (spec §6)
	// ============================================================================

	async createVersion(ctx: RequestContext, version: DefinitionVersion): Promise<void> {
		const config = await this.readConfig();
		const parent = config.definitions[version.definitionId];
		if (!this.live(parent)) {
			throw new ProviderError(`Definition '${version.definitionId}' not found`, 404);
		}
		if (config.definitionVersions[version.id]) {
			throw new ProviderError(`Version '${version.id}' already exists`, 409);
		}
		config.definitionVersions[version.id] = { ...version };
		await this.writeConfig(config);
		await this.events.emit({
			type: 'definition_version.created',
			versionId: version.id,
			definitionId: version.definitionId,
			actorId: actorFrom(ctx)
		});
	}

	async listVersions(
		_ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<DefinitionVersion>> {
		const config = await this.readConfig();
		const parent = config.definitions[definitionId];
		if (!this.live(parent)) return paginate([], opts);
		const rows = Object.values(config.definitionVersions)
			.filter((v) => v.definitionId === definitionId)
			.sort((a, b) => b.versionNumber - a.versionNumber);
		return paginate(rows, opts);
	}

	async getVersion(_ctx: RequestContext, versionId: string): Promise<DefinitionVersion | null> {
		const config = await this.readConfig();
		return config.definitionVersions[versionId] ?? null;
	}

	async setVersionSchema(_ctx: RequestContext, versionId: string, schema: UISchema): Promise<void> {
		const config = await this.readConfig();
		const version = config.definitionVersions[versionId];
		if (!version) return;
		version.schema = schema;
		version.schemaExtractedAt = new Date().toISOString();
		await this.writeConfig(config);
	}

	async deleteVersion(ctx: RequestContext, versionId: string): Promise<void> {
		const config = await this.readConfig();
		const version = config.definitionVersions[versionId];
		if (!version) return;
		const parent = config.definitions[version.definitionId];
		// §6 deletion protection — cannot delete a version while it's serving
		// either channel. Caller must repoint live/draft first.
		if (parent && (parent.liveVersionId === versionId || parent.draftVersionId === versionId)) {
			throw new ProviderError(
				`Version '${versionId}' is referenced by liveVersionId or draftVersionId`,
				409
			);
		}
		delete config.definitionVersions[versionId];
		await this.writeConfig(config);
		await this.events.emit({
			type: 'definition_version.deleted',
			versionId,
			actorId: actorFrom(ctx)
		});
	}

	async setLiveVersion(
		ctx: RequestContext,
		definitionId: string,
		versionId: string
	): Promise<void> {
		await this.repoint('live', ctx, definitionId, versionId);
	}

	async setDraftVersion(
		ctx: RequestContext,
		definitionId: string,
		versionId: string
	): Promise<void> {
		await this.repoint('draft', ctx, definitionId, versionId);
	}

	async attachInitialVersion(
		ctx: RequestContext,
		definitionId: string,
		versionId: string
	): Promise<void> {
		// Single read-modify-write pass: both pointers + status updated together.
		// `writeConfig` is one fs operation, so the 'pending' → 'draft'
		// transition is atomic from any subsequent reader's perspective.
		const config = await this.readConfig();
		const record = config.definitions[definitionId];
		if (!this.live(record)) throw new ProviderError(`Definition '${definitionId}' not found`, 404);
		const version = config.definitionVersions[versionId];
		if (!version || version.definitionId !== definitionId) {
			throw new ProviderError(`Version '${versionId}' not found for this definition`, 404);
		}
		record.liveVersionId = versionId;
		record.draftVersionId = versionId;
		record.status = 'draft';
		Object.assign(record, auditUpdate(ctx, record.updatedBy ?? record.ownerId));
		await this.writeConfig(config);
		// No `definition.published` event — see interface doc. The parent's
		// `definition.created` + `definition_version.created` (emitted earlier
		// in this transaction) cover the bootstrap.
	}

	private async repoint(
		channel: 'live' | 'draft',
		ctx: RequestContext,
		definitionId: string,
		versionId: string
	): Promise<void> {
		const config = await this.readConfig();
		const record = config.definitions[definitionId];
		if (!this.live(record)) throw new ProviderError(`Definition '${definitionId}' not found`, 404);
		const version = config.definitionVersions[versionId];
		if (!version || version.definitionId !== definitionId) {
			throw new ProviderError(`Version '${versionId}' not found for this definition`, 404);
		}
		if (channel === 'live') record.liveVersionId = versionId;
		else record.draftVersionId = versionId;
		Object.assign(record, auditUpdate(ctx, record.updatedBy ?? record.ownerId));
		await this.writeConfig(config);
		// Only `live` advancement is the published-event trigger. Draft
		// repointing is silent — it's the editor's working pointer, not a
		// publication signal.
		if (channel === 'live') {
			await this.events.emit({
				type: 'definition.published',
				definitionId,
				versionId,
				actorId: actorFrom(ctx)
			});
		}
	}
}
