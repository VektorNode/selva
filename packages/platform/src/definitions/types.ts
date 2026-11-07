import type { UISchema } from '@selvajs/schemas';
import type { z } from 'zod';
import type { ListOptions } from '../pagination.js';
import type { DefinitionChannelSchema, DefinitionStatusSchema } from './schemas.js';

const DEFINITION_FILE_EXTS = ['gh', 'ghx'] as const;

export type DefinitionFileExt = (typeof DEFINITION_FILE_EXTS)[number];

export const GH_EXTENSIONS: string[] = DEFINITION_FILE_EXTS.map((ext) => `.${ext}`);

export const COVER_IMAGE_CONTENT_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

/**
 * - `pending` — internal: metadata written, blob upload may be in flight.
 * - `draft` — work in progress, not visible to runners.
 * - `published` — live, visible to all with solve access.
 * - `archived` — retired but preserved; restore via `update({ status: 'draft' | 'published' })`.
 *
 * List endpoints filter out `pending` and `archived` by default (opt in via
 * `DefinitionListOptions.includePending`/`includeArchived`, or an explicit `statuses` filter).
 */
export type DefinitionStatus = z.infer<typeof DefinitionStatusSchema> | 'pending';

/** Definition-specific filtering on top of `ListOptions`. */
export interface DefinitionListOptions extends Omit<ListOptions, 'orderBy'> {
	orderBy?: 'createdAt' | 'updatedAt' | 'name' | 'solveCount';
	/** Include `status='pending'` records. Default false. */
	includePending?: boolean;
	/** Include `status='archived'` records. Default false. */
	includeArchived?: boolean;
	/**
	 * Filter to specific editorial statuses. Omit for the default view (all
	 * non-pending, non-archived). When set, `includePending` / `includeArchived`
	 * are ignored.
	 */
	statuses?: DefinitionStatus[];
	/**
	 * Restrict to definitions in these projects. An empty array matches nothing,
	 * distinct from omitting the filter.
	 *
	 * Applying this in the adapter query — rather than filtering a fetched page
	 * afterwards — is what keeps `limit` and `nextCursor` accurate: filtering
	 * post-fetch can return a page of 50 with 3 items.
	 */
	projectIds?: readonly string[];
	/** Only definitions whose `sourceDocumentId` equals this lowercase GUID. */
	sourceDocumentId?: string;
}

/**
 * Immutable snapshot of a definition's `.gh` file at a point in time. New
 * uploads create new versions; rollback re-points the parent's
 * `liveVersionId` rather than mutating the version itself.
 */
export interface DefinitionVersion {
	id: string;
	definitionId: string;
	/** Allocated from `DefinitionRecord.nextVersionNumber`; see that field for the numbering guarantee. */
	versionNumber: number;
	fileExt: DefinitionFileExt;
	/** Full storage key. Opaque to callers. */
	fileKey: string;
	originalFilename?: string;
	uploadedBy: string;
	uploadedAt: string;
	/** Free-form note describing what changed in this version. */
	changeNote?: string;
	/**
	 * Compute-extracted UI schema, cached at upload so the render path doesn't
	 * re-fetch it from Rhino.Compute on every load. Optional only for the
	 * lazy-backfill bridge on pre-existing versions; new uploads always set it.
	 */
	schema?: UISchema;
	/** ISO timestamp of when `schema` was extracted. */
	schemaExtractedAt?: string;
}

export interface DefinitionRecord {
	guid: string;
	projectId: string;
	/** Current owner — separate from `createdBy` so ownership can transfer. */
	ownerId: string;
	createdBy: string;
	updatedBy: string;
	/** Falls back to the org default, then the platform default. */
	computeServerId?: string;
	/**
	 * Per-definition quota for the shared solve-result cache (`ISolveResultCache`):
	 * `0` = caching off, `N` = keep at most N cached solves, absent = inherit the
	 * backend default.
	 */
	solveCacheLimit?: number;
	displayName: string;
	description?: string;
	category?: string;
	tags?: string[];
	/** Provider-dependent public URL — must be safe to send to clients. */
	coverImage?: string;
	status: DefinitionStatus;
	solveCount: number;
	/**
	 * Monotonic version-number allocator, never decremented: the next upload
	 * reserves this value then advances the counter, so a delete-latest-then-reupload
	 * mints a fresh number and `fileKey` instead of reusing one — otherwise a stale
	 * storage blob could serve the old version's bytes under the new content's key.
	 * Starts at 2 after v1 is created.
	 */
	nextVersionNumber: number;
	/**
	 * Both null only during the brief `pending` window between metadata create
	 * and v1 upload; otherwise both reference live `DefinitionVersion` rows.
	 */
	liveVersionId: string | null;
	draftVersionId: string | null;
	/**
	 * The Grasshopper document GUID (lowercase) from the schema Compute
	 * extracted at the last upload that carried one. A copied `.gh` keeps its
	 * GUID, so this suggests a match and never proves one.
	 */
	sourceDocumentId?: string;
	createdAt: string;
	updatedAt: string;
	/** Soft-delete marker, independent of `status`: a store filters this out regardless of `archived`. */
	deletedAt?: string | null;
}

/**
 * List-row projection of a `DefinitionRecord`; the shape `GET /api/v1/definitions` returns.
 *
 * Deliberately narrower than the full record — `ownerId`, `createdBy`,
 * `updatedBy`, `solveCacheLimit` are internal. v1 is additive-only, so a field
 * published here can only be removed in v2: narrowing later is not an option.
 *
 * `liveVersionId` is the pointer, not a version number — the number isn't a
 * native column, so resolving it would cost a query per row.
 */
export interface DefinitionListItem {
	guid: string;
	projectId: string;
	displayName: string;
	description?: string;
	category?: string;
	tags?: string[];
	coverImage?: string;
	status: DefinitionStatus;
	solveCount: number;
	liveVersionId: string | null;
	/** See {@link DefinitionRecord.sourceDocumentId}. */
	sourceDocumentId: string | null;
	updatedAt: string;
}

export function toDefinitionListItem(r: DefinitionRecord): DefinitionListItem {
	return {
		guid: r.guid,
		projectId: r.projectId,
		displayName: r.displayName,
		description: r.description,
		category: r.category,
		tags: r.tags,
		coverImage: r.coverImage,
		status: r.status,
		solveCount: r.solveCount,
		liveVersionId: r.liveVersionId,
		sourceDocumentId: r.sourceDocumentId ?? null,
		updatedAt: r.updatedAt
	};
}

/**
 * Omits immutable fields and provider-managed ones (use
 * `setLiveVersion`/`setDraftVersion` for channel pointers).
 *
 * - `undefined` — leave unchanged
 * - `null` — clear (only on nullable fields)
 * - value — set
 *
 * Use `incrementSolveCount` for atomic +1 bumps instead of patching `solveCount`.
 */
export interface DefinitionRecordPatch {
	displayName?: string;
	description?: string | null;
	category?: string | null;
	tags?: string[] | null;
	coverImage?: string | null;
	projectId?: string;
	computeServerId?: string | null;
	/** L2 cache quota (see {@link DefinitionRecord.solveCacheLimit}); `null` clears to inherit. */
	solveCacheLimit?: number | null;
	status?: DefinitionStatus;
	ownerId?: string;
	sourceDocumentId?: string | null;
}

export type DefinitionChannel = z.infer<typeof DefinitionChannelSchema>;
