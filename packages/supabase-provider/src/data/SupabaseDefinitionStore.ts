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
	Page
} from '@selvajs/platform';
import { ProviderError, auditSoftDelete, actorFrom, NoopEventSink } from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { nextCursorFromRange, toRange } from './pagination.js';

/**
 * Definition metadata + version store backed by Postgres. Spec §6 versioning:
 * `definitions` carries the parent record and the `live`/`draft` channel
 * pointers; `definition_versions` carries the immutable per-upload rows.
 *
 * Deletion protection (§6) is enforced by FK constraints — `live_version_id`
 * and `draft_version_id` are ON DELETE RESTRICT. Trying to delete a
 * referenced version raises 23503 which `mapError` turns into a 409.
 *
 * `incrementSolveCount` uses a SQL function for atomic UPDATE — no
 * read-modify-write race like the local provider has.
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

		let query = this.clients
			.forRequest(ctx)
			.from('definitions')
			.select('*', { count: 'exact' })
			.is('deleted_at', null);

		if (filter?.projectId) query = query.eq('project_id', filter.projectId);

		if (filter?.publicOnly) {
			query = this.clients
				.forRequest(ctx)
				.from('definitions')
				.select('*, project:projects!inner(visibility, org_id)', {
					count: 'exact'
				})
				.is('deleted_at', null)
				.eq('project.visibility', 'public');
			if (filter.orgId) query = query.eq('project.org_id', filter.orgId);
			if (filter.projectId) query = query.eq('project_id', filter.projectId);
		}

		if (opts?.statuses?.length) {
			query = query.in('status', opts.statuses);
		} else if (!opts?.includePending) {
			query = query.neq('status', 'pending');
		}

		query = query
			.order(definitionOrderColumn(opts?.orderBy), { ascending: direction === 'asc' })
			.range(range.from, range.to);

		const { data, error, count } = await query;
		if (error) throw mapError(error);
		const items = (data ?? []).map(rowToRecord);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async get(ctx: RequestContext, guid: string): Promise<DefinitionRecord | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.select('*')
			.eq('guid', guid)
			.is('deleted_at', null)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToRecord(data) : null;
	}

	async create(ctx: RequestContext, record: DefinitionRecord): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.insert(recordToRow(record));
		if (error) throw mapError(error);
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
		if (ctx.userId) row.updated_by = ctx.userId;

		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.update(row)
			.eq('guid', guid)
			.is('deleted_at', null)
			.select('guid');
		if (error) throw mapError(error);
		if (!data || data.length === 0) throw new ProviderError(`Definition '${guid}' not found`, 404);
	}

	async delete(ctx: RequestContext, guid: string): Promise<void> {
		// Soft-delete (matches the local provider and spec §9). A retention
		// sweep running as service-role hard-deletes later, which cascades
		// versions + share_links via FK.
		const stamp = auditSoftDelete(ctx, ctx.userId);
		const row: Record<string, unknown> = {
			deleted_at: stamp.deletedAt,
			updated_at: stamp.updatedAt
		};
		if (stamp.updatedBy) row.updated_by = stamp.updatedBy;
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.update(row)
			.eq('guid', guid)
			.is('deleted_at', null);
		if (error) throw mapError(error);
		await this.events.emit({
			type: 'definition.deleted',
			definitionId: guid,
			actorId: actorFrom(ctx)
		});
	}

	async incrementSolveCount(ctx: RequestContext, guid: string): Promise<void> {
		const { error } = await this.clients.forRequest(ctx).rpc('increment_run_count', { g: guid });
		if (error) throw mapError(error);
	}

	// ============================================================================
	// Versions (spec §6)
	// ============================================================================

	async createVersion(ctx: RequestContext, version: DefinitionVersion): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.insert(versionToRow(version));
		if (error) throw mapError(error);
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
			.select('*', { count: 'exact' })
			.eq('definition_guid', definitionId)
			.order('version_number', { ascending: false })
			.range(range.from, range.to);
		if (error) throw mapError(error);
		const items = (data ?? []).map(rowToVersion);
		return { items, nextCursor: nextCursorFromRange(range, items.length, count) };
	}

	async getVersion(ctx: RequestContext, versionId: string): Promise<DefinitionVersion | null> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.select('*')
			.eq('id', versionId)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToVersion(data) : null;
	}

	async deleteVersion(ctx: RequestContext, versionId: string): Promise<void> {
		// FK enforcement at the DB layer: live_version_id / draft_version_id
		// are ON DELETE RESTRICT. If the version is referenced by either
		// channel, Postgres raises 23503 → mapError → ProviderError(409).
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definition_versions')
			.delete()
			.eq('id', versionId);
		if (error) throw mapError(error);
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
		// Only `live` advancement is the published-event trigger. Draft
		// repointing is the editor's working pointer, not a publication signal.
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
		// Validate the version belongs to this definition before repointing —
		// matches `repointChannel` so the bootstrap surface enforces the same
		// invariant.
		const { data: version, error: vError } = await client
			.from('definition_versions')
			.select('id, definition_guid')
			.eq('id', versionId)
			.maybeSingle();
		if (vError) throw mapError(vError);
		if (!version || version.definition_guid !== definitionId) {
			throw new ProviderError(`Version '${versionId}' not found for this definition`, 404);
		}

		// Single UPDATE — both channel pointers and status flip in one row
		// write, so a mid-flight failure can't leave a half-promoted record.
		const row: Record<string, unknown> = {
			live_version_id: versionId,
			draft_version_id: versionId,
			status: 'draft'
		};
		if (ctx.userId) row.updated_by = ctx.userId;

		const { data, error } = await client
			.from('definitions')
			.update(row)
			.eq('guid', definitionId)
			.is('deleted_at', null)
			.select('guid');
		if (error) throw mapError(error);
		if (!data || data.length === 0) {
			throw new ProviderError(`Definition '${definitionId}' not found`, 404);
		}
		// No `definition.published` event — see interface doc.
	}

	private async repointChannel(
		ctx: RequestContext,
		definitionId: string,
		versionId: string,
		column: 'live_version_id' | 'draft_version_id'
	): Promise<void> {
		const client = this.clients.forRequest(ctx);
		// Validate the version belongs to this definition before repointing.
		const { data: version, error: vError } = await client
			.from('definition_versions')
			.select('id, definition_guid')
			.eq('id', versionId)
			.maybeSingle();
		if (vError) throw mapError(vError);
		if (!version || version.definition_guid !== definitionId) {
			throw new ProviderError(`Version '${versionId}' not found for this definition`, 404);
		}

		const row: Record<string, unknown> = { [column]: versionId };
		if (ctx.userId) row.updated_by = ctx.userId;
		const { data, error } = await client
			.from('definitions')
			.update(row)
			.eq('guid', definitionId)
			.is('deleted_at', null)
			.select('guid');
		if (error) throw mapError(error);
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
	display_name: string;
	description: string | null;
	category: string | null;
	tags: string[] | null;
	cover_image: string | null;
	status: DefinitionStatus;
	run_count: number | string;
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
		displayName: row.display_name,
		description: row.description ?? undefined,
		category: row.category ?? undefined,
		tags: row.tags ?? undefined,
		coverImage: row.cover_image ?? undefined,
		status: row.status,
		solveCount: typeof row.run_count === 'string' ? Number(row.run_count) : row.run_count,
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
		display_name: r.displayName,
		description: r.description ?? null,
		category: r.category ?? null,
		cover_image: r.coverImage ?? null,
		status: r.status,
		run_count: r.solveCount,
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
		changeNote: row.change_note ?? undefined
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

interface PostgrestError {
	code?: string;
	message?: string;
}

function mapError(e: unknown): Error {
	const pg = e as PostgrestError;
	if (pg?.code === '23505') return new ProviderError(pg.message ?? 'Duplicate record', 409);
	if (pg?.code === '23503') return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	if (e instanceof Error) return e;
	if (e && typeof e === 'object') {
		const obj = e as { message?: string; details?: string; hint?: string; code?: string };
		const msg = obj.message ?? obj.details ?? obj.hint ?? 'Unknown Postgres error';
		const err = new Error(obj.code ? `[${obj.code}] ${msg}` : msg);
		Object.assign(err, obj);
		return err;
	}
	return new Error(String(e));
}
