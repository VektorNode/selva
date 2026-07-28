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
 * - `archived` — retired but preserved. Versions and channel pointers remain
 *   intact; restore via `update({ status: 'draft' | 'published' })`.
 *
 * List endpoints filter `pending` and `archived` by default (opt in via
 * `DefinitionListOptions.includePending` / `includeArchived`, or pass an
 * explicit `statuses` filter).
 */
export type DefinitionStatus = 'pending' | 'draft' | 'published' | 'archived';

/**
 * Immutable snapshot of a definition's `.gh` file at a point in time. New
 * uploads create new versions; rollback re-points the parent's
 * `liveVersionId` (it never mutates the version itself).
 */
export interface DefinitionVersion {
	id: string;
	definitionId: string;
	/**
	 * Monotonic integer starting at 1; NEVER reused — allocated from the parent
	 * record's `nextVersionNumber` counter, which only ever advances. Deleting the
	 * latest version does not free its number, so `fileKey`s never collide.
	 */
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
	 * re-fetch it from Rhino.Compute on every load. Optional only because of the
	 * lazy-backfill bridge for pre-existing versions (see
	 * selva/specs/SchemaCaching.md); new uploads always set it.
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
	 * Durable L2 solve-cache quota for this definition (H1/R9). Absent = inherit
	 * the global default (`SOLVE_CACHE_DEFAULT_MAX_ENTRIES`); `0` = caching off
	 * (the non-determinism / wide-input-space escape hatch); `N` = keep at most N
	 * cached solves for this definition. One number, one settings input.
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
	 * Monotonic version-number allocator. The next `uploadVersion` reserves this
	 * value for the new version's `versionNumber` (and `fileKey`) then advances
	 * the counter — it is NEVER decremented, so delete-latest-then-reupload mints
	 * a FRESH number and a FRESH `fileKey` rather than reusing the deleted one.
	 * Reusing a `fileKey` would let a stale storage blob (or any layer keying on
	 * the key) serve the old version's bytes for the new content. Starts at 2
	 * after v1 is created.
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
	deletedAt?: string | null;
}

/**
 * Patch omits immutable fields and provider-managed ones (use
 * `setLiveVersion`/`setDraftVersion` for the latter).
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
	/** Ownership transfer. */
	ownerId?: string;
}

/** Channel for solve dispatch. */
export type DefinitionChannel = 'live' | 'draft';
