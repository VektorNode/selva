import type {
	IDefinitionStore,
	IEventSink,
	DefinitionRecord,
	DefinitionRecordPatch,
	DefinitionStatus,
	DefinitionFileExt,
	DefinitionVersion,
	RequestContext,
	DefinitionListOptions,
	ListOptions,
	Page,
	UISchema
} from '@selvajs/platform';
import { ProviderError, actorFrom, NoopEventSink } from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';
import { nextCursorFromRange, toRange } from './pagination.js';
import { stampSoftDelete, stampUpdate } from './rowStamp.js';

/** Explicit column list for `definitions` — every field `rowToRecord` consumes. */
const DEFINITION_COLUMNS =
	'guid, project_id, owner_id, created_by, updated_by, compute_server_id, solve_cache_limit, display_name, description, category, tags, cover_image, status, run_count, next_version_number, live_version_id, draft_version_id, created_at, updated_at, deleted_at';
/**
 * Explicit column list for `definition_versions`, minus the `schema` JSONB.
 * `schema` can be hundreds of KB per row, so the list projection leaves it out
 * and `listVersions` returns rows with `schema: undefined`; only `getVersion`
 * (which reads one row, for a caller that needs the schema) pulls it in.
 */
const DEFINITION_VERSION_COLUMNS =
	'id, definition_guid, version_number, file_ext, file_key, original_filename, uploaded_by, uploaded_at, change_note, schema_extracted_at';
/**
 * `getVersion`'s projection — the list columns plus the `schema` JSONB. Spelled
 * out rather than built with a template literal: supabase-js infers the row
 * type from the literal column string, and a template literal degrades it to
 * `string`.
 */
const DEFINITION_VERSION_COLUMNS_WITH_SCHEMA =
	'id, definition_guid, version_number, file_ext, file_key, original_filename, uploaded_by, uploaded_at, change_note, schema_extracted_at, schema';

/**
 * Definition metadata + version store backed by Postgres. `definitions` carries
 * the parent record and the `live`/`draft` channel pointers; `definition_versions`
 * carries the immutable per-upload rows.
 */
export class SupabaseDefinitionStore implements IDefinitionStore {
	private readonly events: IEventSink;

	constructor(
		private readonly clients: ClientBundle,
		events: IEventSink = new NoopEventSink()
	) {
		this.events = events;
	}

	// ============================================================================
	// Definitions
	// ============================================================================

	async list(ctx: RequestContext, opts?: DefinitionListOptions): Promise<Page<DefinitionRecord>> {
		return this.runList(ctx, undefined, opts);
	}

	async listByProject(
		ctx: RequestContext,
		projectId: string,
		opts?: DefinitionListOptions
	): Promise<Page<DefinitionRecord>> {
		return this.runList(ctx, { projectId }, opts);
	}

	async listPublic(
		ctx: RequestContext,
		opts?: DefinitionListOptions & { orgId?: string }
	): Promise<Page<DefinitionRecord>> {
		return this.runList(ctx, { publicOnly: true, orgId: opts?.orgId }, opts);
	}

	private async runList(
		ctx: RequestContext,
		filter: { projectId?: string; publicOnly?: boolean; orgId?: string } | undefined,
		opts?: DefinitionListOptions
	): Promise<Page<DefinitionRecord>> {
		const range = toRange(opts);
		const direction = opts?.orderDir ?? 'desc';

		// Picked up front so there's a single `.select()` call — calling it twice
		// (once per branch) would give the builder two different inferred types.
		const selectColumns = filter?.publicOnly
			? `${DEFINITION_COLUMNS}, project:projects!inner(visibility, org_id)`
			: DEFINITION_COLUMNS;

		let query = this.clients
			.forRequest(ctx)
			.from('definitions')
			.select(selectColumns, { count: 'exact' })
			.is('deleted_at', null);

		if (filter?.publicOnly) {
			query = query.eq('project.visibility', 'public');
			if (filter.orgId) query = query.eq('project.org_id', filter.orgId);
		}

		if (filter?.projectId) query = query.eq('project_id', filter.projectId);

		// An empty `projectIds` must match nothing. PostgREST's `in.()` is a syntax
		// error, so short-circuit rather than building the query.
		if (opts?.projectIds) {
			if (opts.projectIds.length === 0) return { items: [] };
			query = query.in('project_id', [...opts.projectIds]);
		}

		if (opts?.statuses?.length) {
			query = query.in('status', opts.statuses);
		} else {
			const excluded: string[] = [];
			if (!opts?.includePending) excluded.push('pending');
			if (!opts?.includeArchived) excluded.push('archived');
			if (excluded.length) {
				query = query.not('status', 'in', `(${excluded.join(',')})`);
			}
		}

		query = query
			.order(definitionOrderColumn(opts?.orderBy), { ascending: direction === 'asc' })
			.range(range.from, range.to);

		const { data, error, count } = await query;
		if (error) throw mapPostgrestError(error);
		// `data`'s type comes from the dynamic select string, which PostgREST
		// can't resolve to a row shape — the columns are all present regardless,
		// so cast through the known `DefinitionRow`.
		const items = ((data ?? []) as unknown as DefinitionRow[]).map(rowToRecord);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async get(ctx: RequestContext, guid: string): Promise<DefinitionRecord | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.select(DEFINITION_COLUMNS)
			.eq('guid', guid)
			.is('deleted_at', null)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToRecord(data) : null;
	}

	async create(ctx: RequestContext, record: DefinitionRecord): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.insert(recordToRow(record));
		if (error) throw mapPostgrestError(error);
		await this.events.emit({
			type: 'definition.created',
			definitionId: record.guid,
			projectId: record.projectId,
			actorId: actorFrom(ctx)
		});
	}

	async update(ctx: RequestContext, guid: string, patch: DefinitionRecordPatch): Promise<void> {
		const row = patchToRow(patch);
		if (Object.keys(row).length === 0) return;
		Object.assign(row, stampUpdate(ctx));

		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.update(row)
			.eq('guid', guid)
			.is('deleted_at', null)
			.select('guid');
		if (error) throw mapPostgrestError(error);
		if (!data || data.length === 0) throw new ProviderError(`Definition '${guid}' not found`, 404);
	}

	async delete(ctx: RequestContext, guid: string): Promise<void> {
		// Soft-delete, matching the local provider. A retention sweep running
		// as service-role hard-deletes later, which cascades versions +
		// share_links via FK.
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.update(stampSoftDelete(ctx))
			.eq('guid', guid)
			.is('deleted_at', null);
		if (error) throw mapPostgrestError(error);
		await this.events.emit({
			type: 'definition.deleted',
			definitionId: guid,
			actorId: actorFrom(ctx)
		});
	}

	async deleteByProject(ctx: RequestContext, projectId: string): Promise<void> {
		// Cascade from `deleteProject`. `select('guid')` returns the affected rows
		// so we can emit a `definition.deleted` per record, matching the local
		// provider and the single-`delete` path above.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.update(stampSoftDelete(ctx))
			.eq('project_id', projectId)
			.is('deleted_at', null)
			.select('guid');
		if (error) throw mapPostgrestError(error);
		for (const row of data ?? []) {
			await this.events.emit({
				type: 'definition.deleted',
				definitionId: row.guid,
				actorId: actorFrom(ctx)
			});
		}
	}

	async incrementSolveCount(ctx: RequestContext, guid: string): Promise<void> {
		const { error } = await this.clients.forRequest(ctx).rpc('increment_run_count', { g: guid });
		if (error) throw mapPostgrestError(error);
	}

	async reserveNextVersionNumber(ctx: RequestContext, guid: string): Promise<number> {
		// Atomic reserve-and-increment in one SQL function — no read-modify-write
		// race. Raises no_data_found (mapped to 404) when the definition is
		// missing or soft-deleted.
		const { data, error } = await this.clients
			.forRequest(ctx)
			.rpc('reserve_next_version_number', { g: guid });
		if (error) throw mapPostgrestError(error);
		if (typeof data !== 'number') {
			throw new ProviderError(`Definition '${guid}' not found`, 404);
		}
		return data;
	}

	// ============================================================================
	// Versions
	// ============================================================================

	async createVersion(ctx: RequestContext, version: DefinitionVersion): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.insert(versionToRow(version));
		if (error) throw mapPostgrestError(error);
		await this.events.emit({
			type: 'definition_version.created',
			versionId: version.id,
			definitionId: version.definitionId,
			actorId: actorFrom(ctx)
		});
	}

	async listVersions(
		ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<DefinitionVersion>> {
		const range = toRange(opts);
		const { data, error, count } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.select(DEFINITION_VERSION_COLUMNS, { count: 'exact' })
			.eq('definition_guid', definitionId)
			.order('version_number', { ascending: false })
			.range(range.from, range.to);
		if (error) throw mapPostgrestError(error);
		const items = (data ?? []).map(rowToVersion);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getVersion(ctx: RequestContext, versionId: string): Promise<DefinitionVersion | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.select(DEFINITION_VERSION_COLUMNS_WITH_SCHEMA)
			.eq('id', versionId)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		return data ? rowToVersion(data) : null;
	}

	async setVersionSchema(ctx: RequestContext, versionId: string, schema: UISchema): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.update({ schema, schema_extracted_at: new Date().toISOString() })
			.eq('id', versionId);
		if (error) throw mapPostgrestError(error);
	}

	async deleteVersion(ctx: RequestContext, versionId: string): Promise<void> {
		// live_version_id / draft_version_id are ON DELETE RESTRICT — if the
		// version is referenced by either channel, Postgres raises 23503 →
		// mapPostgrestError → ProviderError(409).
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.delete()
			.eq('id', versionId);
		if (error) throw mapPostgrestError(error);
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
		await this.repointChannel(ctx, definitionId, versionId, 'live_version_id');
		// Only `live` advancement fires `definition.published`. Draft repointing
		// is the editor's working pointer, not a publication signal.
		await this.events.emit({
			type: 'definition.published',
			definitionId,
			versionId,
			actorId: actorFrom(ctx)
		});
	}

	async setDraftVersion(
		ctx: RequestContext,
		definitionId: string,
		versionId: string
	): Promise<void> {
		await this.repointChannel(ctx, definitionId, versionId, 'draft_version_id');
	}

	async attachInitialVersion(
		ctx: RequestContext,
		definitionId: string,
		versionId: string
	): Promise<void> {
		const client = this.clients.forRequest(ctx);
		// Duplicates repointChannel's ownership check rather than calling it,
		// so the bootstrap path enforces the same invariant independently of
		// the two-channel repoint logic.
		const { data: version, error: vError } = await client
			.from('definition_versions')
			.select('id, definition_guid')
			.eq('id', versionId)
			.maybeSingle();
		if (vError) throw mapPostgrestError(vError);
		if (!version || version.definition_guid !== definitionId) {
			throw new ProviderError(`Version '${versionId}' not found for this definition`, 404);
		}

		// Single UPDATE — both channel pointers and status flip in one row
		// write, so a mid-flight failure can't leave a half-promoted record.
		const row: Record<string, unknown> = {
			live_version_id: versionId,
			draft_version_id: versionId,
			status: 'draft',
			...stampUpdate(ctx)
		};

		const { data, error } = await client
			.from('definitions')
			.update(row)
			.eq('guid', definitionId)
			.is('deleted_at', null)
			.select('guid');
		if (error) throw mapPostgrestError(error);
		if (!data || data.length === 0) {
			throw new ProviderError(`Definition '${definitionId}' not found`, 404);
		}
		// No `definition.published` event: this is a bootstrap, not a publish.
	}

	private async repointChannel(
		ctx: RequestContext,
		definitionId: string,
		versionId: string,
		column: 'live_version_id' | 'draft_version_id'
	): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const { data: version, error: vError } = await client
			.from('definition_versions')
			.select('id, definition_guid')
			.eq('id', versionId)
			.maybeSingle();
		if (vError) throw mapPostgrestError(vError);
		if (!version || version.definition_guid !== definitionId) {
			throw new ProviderError(`Version '${versionId}' not found for this definition`, 404);
		}

		const row: Record<string, unknown> = { [column]: versionId, ...stampUpdate(ctx) };
		const { data, error } = await client
			.from('definitions')
			.update(row)
			.eq('guid', definitionId)
			.is('deleted_at', null)
			.select('guid');
		if (error) throw mapPostgrestError(error);
		if (!data || data.length === 0) {
			throw new ProviderError(`Definition '${definitionId}' not found`, 404);
		}
	}
}

// ============================================================================
// Row ↔ domain mappers
// ============================================================================
interface DefinitionRow {
	guid: string;
	project_id: string;
	owner_id: string;
	created_by?: string | null;
	updated_by?: string | null;
	compute_server_id: string | null;
	solve_cache_limit: number | string | null;
	display_name: string;
	description: string | null;
	category: string | null;
	tags: string[] | null;
	cover_image: string | null;
	status: DefinitionStatus;
	run_count: number | string;
	next_version_number: number | string;
	live_version_id: string | null;
	draft_version_id: string | null;
	created_at: string;
	updated_at: string;
	deleted_at?: string | null;
}

interface DefinitionVersionRow {
	id: string;
	definition_guid: string;
	version_number: number;
	file_ext: DefinitionFileExt;
	file_key: string;
	original_filename: string | null;
	uploaded_by: string;
	uploaded_at: string;
	change_note?: string | null;
	schema?: UISchema | null;
	schema_extracted_at?: string | null;
}

function rowToRecord(row: DefinitionRow): DefinitionRecord {
	return {
		guid: row.guid,
		projectId: row.project_id,
		ownerId: row.owner_id,
		createdBy: row.created_by ?? row.owner_id,
		updatedBy: row.updated_by ?? row.owner_id,
		liveVersionId: row.live_version_id,
		draftVersionId: row.draft_version_id,
		computeServerId: row.compute_server_id ?? undefined,
		solveCacheLimit:
			row.solve_cache_limit == null
				? undefined
				: typeof row.solve_cache_limit === 'string'
					? Number(row.solve_cache_limit)
					: row.solve_cache_limit,
		displayName: row.display_name,
		description: row.description ?? undefined,
		category: row.category ?? undefined,
		tags: row.tags ?? undefined,
		coverImage: row.cover_image ?? undefined,
		status: row.status,
		solveCount: typeof row.run_count === 'string' ? Number(row.run_count) : row.run_count,
		nextVersionNumber:
			typeof row.next_version_number === 'string'
				? Number(row.next_version_number)
				: row.next_version_number,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at ?? null
	};
}

function recordToRow(r: DefinitionRecord): Record<string, unknown> {
	const row: Record<string, unknown> = {
		guid: r.guid,
		project_id: r.projectId,
		owner_id: r.ownerId,
		created_by: r.createdBy,
		updated_by: r.updatedBy,
		live_version_id: r.liveVersionId,
		draft_version_id: r.draftVersionId,
		compute_server_id: r.computeServerId ?? null,
		solve_cache_limit: r.solveCacheLimit ?? null,
		display_name: r.displayName,
		description: r.description ?? null,
		category: r.category ?? null,
		cover_image: r.coverImage ?? null,
		status: r.status,
		run_count: r.solveCount,
		next_version_number: r.nextVersionNumber,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
		deleted_at: r.deletedAt ?? null
	};
	if (r.tags !== undefined) row.tags = r.tags;
	return row;
}

function patchToRow(patch: DefinitionRecordPatch): Record<string, unknown> {
	const row: Record<string, unknown> = {};
	if (patch.displayName !== undefined) row.display_name = patch.displayName;
	if (patch.description !== undefined) row.description = patch.description;
	if (patch.category !== undefined) row.category = patch.category;
	if (patch.tags !== undefined) row.tags = patch.tags;
	if (patch.coverImage !== undefined) row.cover_image = patch.coverImage;
	if (patch.projectId !== undefined) row.project_id = patch.projectId;
	if (patch.computeServerId !== undefined) row.compute_server_id = patch.computeServerId;
	if (patch.solveCacheLimit !== undefined) row.solve_cache_limit = patch.solveCacheLimit;
	if (patch.status !== undefined) row.status = patch.status;
	if (patch.ownerId !== undefined) row.owner_id = patch.ownerId;
	return row;
}

function rowToVersion(row: DefinitionVersionRow): DefinitionVersion {
	return {
		id: row.id,
		definitionId: row.definition_guid,
		versionNumber: row.version_number,
		fileExt: row.file_ext,
		fileKey: row.file_key,
		originalFilename: row.original_filename ?? undefined,
		uploadedBy: row.uploaded_by,
		uploadedAt: row.uploaded_at,
		changeNote: row.change_note ?? undefined,
		schema: row.schema ?? undefined,
		schemaExtractedAt: row.schema_extracted_at ?? undefined
	};
}

function versionToRow(v: DefinitionVersion): Record<string, unknown> {
	const row: Record<string, unknown> = {
		id: v.id,
		definition_guid: v.definitionId,
		version_number: v.versionNumber,
		file_ext: v.fileExt,
		file_key: v.fileKey,
		original_filename: v.originalFilename ?? null,
		uploaded_by: v.uploadedBy,
		uploaded_at: v.uploadedAt
	};
	if (v.changeNote !== undefined) row.change_note = v.changeNote;
	if (v.schema !== undefined) row.schema = v.schema;
	if (v.schemaExtractedAt !== undefined) row.schema_extracted_at = v.schemaExtractedAt;
	return row;
}

function definitionOrderColumn(orderBy: DefinitionListOptions['orderBy'] | undefined): string {
	switch (orderBy) {
		case 'name':
			return 'display_name';
		case 'solveCount':
			return 'run_count';
		case 'updatedAt':
			return 'updated_at';
		case 'createdAt':
		default:
			return 'created_at';
	}
}
