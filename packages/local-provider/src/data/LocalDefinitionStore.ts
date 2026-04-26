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
	Page
} from '@selva/platform';
import {
	ProviderError,
	hasPermission,
	auditUpdate,
	auditSoftDelete,
	actorFrom,
	NoopEventSink,
	canEditDefinition
} from '@selva/platform';
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
		return readJsonFile<DefinitionsConfig>(this.configPath, empty());
	}

	private live(record: DefinitionRecord | undefined | null): record is DefinitionRecord {
		return Boolean(record && record.deletedAt == null);
	}

	private async writeConfig(config: DefinitionsConfig): Promise<void> {
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
			if (field === 'runCount') return r.runCount ?? 0;
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
		if (opts?.includePending) return filtered;
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

	async incrementRunCount(_ctx: RequestContext, guid: string): Promise<void> {
		const config = await this.readConfig();
		const existing = config.definitions[guid];
		if (!this.live(existing)) return;
		existing.runCount = (existing.runCount ?? 0) + 1;
		existing.updatedAt = new Date().toISOString();
		await this.writeConfig(config);
	}

	async listStalePending(_ctx: RequestContext, olderThanIso: string): Promise<DefinitionRecord[]> {
		const config = await this.readConfig();
		return Object.values(config.definitions).filter(
			(r) => this.live(r) && r.status === ('pending' as string) && r.createdAt <= olderThanIso
		);
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

	async canEditDefinition(
		ctx: RequestContext,
		projectId: string,
		definitionGuid: string
	): Promise<boolean> {
		if (!this.projectProvider) return false;
		if (hasPermission(ctx, 'instance_admin')) return true;

		const [project, definition, member] = await Promise.all([
			this.projectProvider.getProject(ctx, projectId),
			this.get(ctx, definitionGuid),
			this.projectProvider.getProjectMember(ctx, projectId, ctx.userId)
		]);

		return canEditDefinition({
			platformPermissions: ctx.platformPermissions,
			project,
			definition,
			member,
			userId: ctx.userId
		});
	}
}
