import type { UISchema } from '@selvajs/schemas';

export type DefinitionFileExt = 'gh' | 'ghx';

export const GH_EXTENSIONS: string[] = ['.gh', '.ghx'];
export const COVER_IMAGE_EXTENSIONS: string[] = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
export const ALLOWED_UPLOAD_EXTENSIONS: string[] = [...GH_EXTENSIONS, ...COVER_IMAGE_EXTENSIONS];

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
export type DefinitionStatus = 'pending' | 'draft' | 'published' | 'archived';

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
	 * Per-definition quota for a shared solve-result cache: `0` = caching off,
	 * `N` = keep at most N cached solves, absent = inherit the backend default.
	 *
	 * **Dormant.** No shared backend ships today (see `ISolveResultCache`), so
	 * this affects nothing at solve time yet. Kept as a persisted column rather
	 * than removed, since it's the right knob once a backend exists.
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
}

export type DefinitionChannel = 'live' | 'draft';
