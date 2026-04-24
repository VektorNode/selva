import type {
	IDefinitionStore,
	DefinitionRecord,
	DefinitionRecordPatch,
	DefinitionStatus,
	DefinitionFileExt,
	HistoryEntry,
	RequestContext,
	DefinitionListOptions,
	Page
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
import type { ClientBundle } from './client.js';
import { nextCursorFromRange, toRange } from './pagination.js';

/**
 * Definition metadata store backed by Postgres. The parent `definitions`
 * table holds the record; `definition_history` holds each historical version.
 * `get` / `list` stitch them together via a foreign-table select so callers
 * see the same `DefinitionRecord` shape as the local provider.
 *
 * `incrementRunCount` uses a dedicated RPC — atomic UPDATE in SQL. Closes
 * the read-modify-write race the local provider still has.
 */
export class SupabaseDefinitionStore implements IDefinitionStore {
	constructor(private readonly clients: ClientBundle) {}

	async list(
		ctx: RequestContext,
		opts?: DefinitionListOptions
	): Promise<Page<DefinitionRecord>> {
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
			.select('*, history:definition_history(*)', { count: 'exact' });

		if (filter?.projectId) query = query.eq('project_id', filter.projectId);

		if (filter?.publicOnly) {
			// Filter to public projects via an inner join projection. PostgREST
			// syntax: `project:projects!inner(visibility)` + eq on the joined
			// column. The `!inner` is critical — without it the join doesn't
			// filter, it just attaches.
			query = this.clients
				.forRequest(ctx)
				.from('definitions')
				.select('*, history:definition_history(*), project:projects!inner(visibility, org_id)', {
					count: 'exact'
				})
				.eq('project.visibility', 'public');
			if (filter.orgId) query = query.eq('project.org_id', filter.orgId);
			if (filter.projectId) query = query.eq('project_id', filter.projectId);
		}

		// Status filter. Default hides `pending`.
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
			.select('*, history:definition_history(*)')
			.eq('guid', guid)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToRecord(data) : null;
	}

	async create(ctx: RequestContext, record: DefinitionRecord): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const { error } = await client.from('definitions').insert(recordToRow(record));
		if (error) throw mapError(error);

		// Seed any history entries the caller constructed up-front. Typical
		// callers create with an empty history and append via addHistoryEntry.
		if (record.history.length > 0) {
			const rows = record.history.map((h) => historyToRow(record.guid, h));
			const { error: histError } = await client.from('definition_history').insert(rows);
			if (histError) throw mapError(histError);
		}
	}

	async update(
		ctx: RequestContext,
		guid: string,
		patch: DefinitionRecordPatch
	): Promise<void> {
		const row = patchToRow(patch);
		if (Object.keys(row).length === 0) return;

		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.update(row)
			.eq('guid', guid)
			.select('guid');
		if (error) throw mapError(error);
		if (!data || data.length === 0) throw new ProviderError(`Definition '${guid}' not found`, 404);
	}

	async addHistoryEntry(
		ctx: RequestContext,
		guid: string,
		entry: HistoryEntry
	): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definition_history')
			.insert(historyToRow(guid, entry));
		if (error) throw mapError(error);
	}

	async removeHistoryEntry(
		ctx: RequestContext,
		guid: string,
		ref: string
	): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definition_history')
			.delete()
			.eq('definition_guid', guid)
			.eq('ref', ref);
		if (error) throw mapError(error);
	}

	async delete(ctx: RequestContext, guid: string): Promise<void> {
		const { error } = await this.clients
			.forRequest(ctx)
			.from('definitions')
			.delete()
			.eq('guid', guid);
		if (error) throw mapError(error);
	}

	async incrementRunCount(ctx: RequestContext, guid: string): Promise<void> {
		// Atomic UPDATE via a SQL function — no read-modify-write race.
		const { error } = await this.clients
			.forRequest(ctx)
			.rpc('increment_run_count', { g: guid });
		if (error) throw mapError(error);
	}

	async listStalePending(
		ctx: RequestContext,
		olderThanIso: string
	): Promise<DefinitionRecord[]> {
		// System-only by contract. Force the service-role client so the
		// RLS policies don't scope us down even if the caller forgets the
		// `system: true` flag.
		const client = ctx.system ? this.clients.forRequest(ctx) : this.clients.serviceClient;
		const { data, error } = await client
			.from('definitions')
			.select('*, history:definition_history(*)')
			.eq('status', 'pending')
			.lt('updated_at', olderThanIso);
		if (error) throw mapError(error);
		return (data ?? []).map(rowToRecord);
	}

	async canEditDefinition(
		ctx: RequestContext,
		projectId: string,
		userId: string,
		definitionOwnerId: string
	): Promise<boolean> {
		if (ctx.platformPermissions.includes('platform_admin')) return true;

		// Load the parent project to read its visibility + org_id.
		const { data: project } = await this.clients
			.forRequest(ctx)
			.from('projects')
			.select('visibility, org_id')
			.eq('id', projectId)
			.maybeSingle();
		if (!project) return false;

		const { data: member } = await this.clients
			.forRequest(ctx)
			.from('project_members')
			.select('role')
			.eq('project_id', projectId)
			.eq('user_id', userId)
			.maybeSingle();

		if (project.visibility === 'public') {
			return userId === definitionOwnerId;
		}
		if (project.visibility === 'org') {
			if (userId === definitionOwnerId) return true;
			return member?.role === 'owner' || member?.role === 'editor';
		}
		// private
		return member?.role === 'owner' || member?.role === 'editor';
	}
}

// ── Row ↔ domain mappers ────────────────────────────────────────────────

interface DefinitionRow {
	guid: string;
	project_id: string;
	owner_id: string;
	last_edited_by: string | null;
	compute_server_id: string | null;
	file_ext: DefinitionFileExt;
	original_filename: string | null;
	display_name: string;
	description: string | null;
	category: string | null;
	tags: string[] | null;
	cover_image: string | null;
	max_history: number;
	status: DefinitionStatus;
	run_count: number | string; // Postgres bigint round-trips as string under some drivers.
	created_at: string;
	updated_at: string;
	history?: HistoryRow[];
}

interface HistoryRow {
	definition_guid: string;
	ref: string;
	original_name: string;
	archived_at: string;
	uploaded_by: string | null;
	note: string | null;
}

function rowToRecord(row: DefinitionRow): DefinitionRecord {
	const history = (row.history ?? [])
		.map(rowToHistory)
		.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
	return {
		guid: row.guid,
		projectId: row.project_id,
		ownerId: row.owner_id,
		lastEditedBy: row.last_edited_by ?? undefined,
		computeServerId: row.compute_server_id ?? undefined,
		fileExt: row.file_ext,
		originalFilename: row.original_filename ?? undefined,
		displayName: row.display_name,
		description: row.description ?? undefined,
		category: row.category ?? undefined,
		tags: row.tags ?? undefined,
		coverImage: row.cover_image ?? undefined,
		history,
		maxHistory: row.max_history,
		status: row.status,
		runCount: typeof row.run_count === 'string' ? Number(row.run_count) : row.run_count,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function rowToHistory(row: HistoryRow): HistoryEntry {
	return {
		ref: row.ref,
		originalName: row.original_name,
		archivedAt: row.archived_at,
		uploadedBy: row.uploaded_by ?? undefined,
		note: row.note ?? undefined
	};
}

function recordToRow(r: DefinitionRecord): Record<string, unknown> {
	// Build the row without `null` for fields that have NOT NULL DEFAULT in SQL
	// (e.g. `tags`). Send `undefined` for absent values so PostgREST lets the
	// column default apply. `last_edited_by` etc. are nullable — null is fine
	// there.
	const row: Record<string, unknown> = {
		guid: r.guid,
		project_id: r.projectId,
		owner_id: r.ownerId,
		last_edited_by: r.lastEditedBy ?? null,
		compute_server_id: r.computeServerId ?? null,
		file_ext: r.fileExt,
		original_filename: r.originalFilename ?? null,
		display_name: r.displayName,
		description: r.description ?? null,
		category: r.category ?? null,
		cover_image: r.coverImage ?? null,
		max_history: r.maxHistory,
		status: r.status,
		run_count: r.runCount,
		created_at: r.createdAt,
		updated_at: r.updatedAt
	};
	// `tags` is NOT NULL DEFAULT '{}' — include it only when the caller gives
	// us an array; otherwise let the default apply.
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
	if (patch.fileExt !== undefined) row.file_ext = patch.fileExt;
	if (patch.originalFilename !== undefined) row.original_filename = patch.originalFilename;
	if (patch.maxHistory !== undefined) row.max_history = patch.maxHistory;
	if (patch.projectId !== undefined) row.project_id = patch.projectId;
	if (patch.computeServerId !== undefined) row.compute_server_id = patch.computeServerId;
	if (patch.status !== undefined) row.status = patch.status;
	if (patch.lastEditedBy !== undefined) row.last_edited_by = patch.lastEditedBy;
	return row;
}

function historyToRow(guid: string, h: HistoryEntry): HistoryRow {
	return {
		definition_guid: guid,
		ref: h.ref,
		original_name: h.originalName,
		archived_at: h.archivedAt,
		uploaded_by: h.uploadedBy ?? null,
		note: h.note ?? null
	};
}

function definitionOrderColumn(orderBy: DefinitionListOptions['orderBy'] | undefined): string {
	switch (orderBy) {
		case 'name':
			return 'display_name';
		case 'runCount':
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
	// PostgREST errors are plain objects (not Error instances). Preserve their
	// shape so `message`/`code`/`details` propagate instead of becoming
	// "[object Object]".
	if (e && typeof e === 'object') {
		const obj = e as { message?: string; details?: string; hint?: string; code?: string };
		const msg = obj.message ?? obj.details ?? obj.hint ?? 'Unknown Postgres error';
		const err = new Error(obj.code ? `[${obj.code}] ${msg}` : msg);
		Object.assign(err, obj);
		return err;
	}
	return new Error(String(e));
}
