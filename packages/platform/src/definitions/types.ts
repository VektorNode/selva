export type DefinitionFileExt = 'gh' | 'ghx';

/** File extensions accepted for Grasshopper definitions (with dot) */
export const GH_EXTENSIONS: string[] = ['.gh', '.ghx'];

/** Image extensions accepted for cover images (with dot) */
export const COVER_IMAGE_EXTENSIONS: string[] = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/** All accepted upload extensions */
export const ALLOWED_UPLOAD_EXTENSIONS: string[] = [...GH_EXTENSIONS, ...COVER_IMAGE_EXTENSIONS];

/** MIME types for image extensions */
export const COVER_IMAGE_CONTENT_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export interface HistoryEntry {
	/**
	 * Archive key for this entry — a suffix only (UUID + sanitized filename).
	 * The full storage path is constructed via `definitionPaths.archive(guid, ref)`.
	 * e.g. "550e8400-e29b-41d4-a716-446655440000_definition.gh"
	 */
	ref: string;
	/** Original uploaded filename, for display purposes */
	originalName: string;
	/** ISO 8601 date of when the file was archived */
	archivedAt: string;
	/** ID of the user who uploaded this version */
	uploadedBy?: string;
	/** Optional changelog note for this version */
	note?: string;
}

/**
 * Lifecycle status of a definition record.
 *
 * Internal upload state:
 * - 'pending' — metadata written, blob upload may be in flight or may have failed
 *
 * Editorial workflow (visible to project editors/owners):
 * - 'draft'     — work in progress, not visible to runners
 * - 'review'    — submitted for review, read-only for editors
 * - 'published' — live and visible to all project members with solve access
 * - 'archived'  — retired, hidden from runners but preserved for history
 *
 * List endpoints filter out 'pending' by default. Runners only see 'published'.
 * A janitor sweeps stale 'pending' records.
 */
export type DefinitionStatus = 'pending' | 'draft' | 'review' | 'published' | 'archived';

/**
 * Immutable snapshot of a definition's `.gh` file at a point in time.
 *
 * Scaffold only (B4): the entity exists so adapters can round-trip rows and
 * tests can assert the shape, but no upload/publish/rollback flow consumes
 * versions yet. That wiring lands with PR A's versioning work. See spec §6.
 */
export interface DefinitionVersion {
	/** UUID v4 primary key */
	id: string;
	/** UUID of the parent definition */
	definitionId: string;
	/** Monotonic integer starting at 1 and incrementing on each upload. */
	versionNumber: number;
	/** Storage key for this version's blob (opaque to the domain layer). */
	fileKey: string;
	/** UUID of the user who uploaded this version. */
	uploadedBy: string;
	uploadedAt: string; // ISO 8601
}

export interface DefinitionRecord {
	/** UUID v4 primary key */
	guid: string;
	/** UUID of the project that owns this definition */
	projectId: string;
	/**
	 * UUID of the user who currently owns this definition (as a business
	 * concept — the "uploader" for commons projects). Separate from
	 * `createdBy` so ownership can be transferred without losing attribution.
	 */
	ownerId: string;
	/** UUID of the user who created this definition. Immutable. */
	createdBy: string;
	/** UUID of the user who last mutated this definition. */
	updatedBy: string;
	/**
	 * Optional UUID of a specific compute server to use when solving.
	 * Falls back to the org default, then the platform default.
	 */
	computeServerId?: string;
	fileExt: DefinitionFileExt;
	/** Original uploaded filename, kept for display only. Refreshed on each file upload. */
	originalFilename?: string;
	displayName: string;
	description?: string;
	category?: string;
	tags?: string[];
	/**
	 * Public URL to cover image — provider-dependent (CDN URL, signed S3, etc.).
	 * Provider must ensure this URL is safe to send to clients and does not leak
	 * internal storage paths or unsecured file locations.
	 */
	coverImage?: string;
	/** File version history, newest first */
	history: HistoryEntry[];
	/** Maximum archived versions to keep. 0 = unlimited. */
	maxHistory: number;
	/** Lifecycle status. See DefinitionStatus. */
	status: DefinitionStatus;
	/** Total number of successful solve runs across all time. */
	runCount: number;
	/**
	 * Versioning scaffold (B4). `liveVersionId` points at the DefinitionVersion
	 * external consumers solve; `draftVersionId` is what project editors test
	 * against. Both are null until the upload/publish flow is wired in PR A.
	 * Legacy code paths keep writing to `history[]` — the scaffold fields just
	 * make the data model forward-compatible. Spec §6.
	 */
	liveVersionId?: string | null;
	draftVersionId?: string | null;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
	/**
	 * ISO 8601 soft-delete timestamp. Null means live. All reads filter out
	 * non-null at the data-access layer.
	 */
	deletedAt?: string | null;
}

/**
 * Patch input for `IDefinitionStore.update`. Omits immutable fields (`guid`,
 * `createdBy`, `createdAt`) and provider-managed fields (`updatedAt`,
 * `updatedBy`, `history`, `deletedAt`).
 *
 * Field semantics:
 * - missing / `undefined` — leave unchanged
 * - `null` — clear the field (only nullable fields below accept null)
 * - value — set
 *
 * Use `IDefinitionStore.incrementRunCount` for atomic "+1" run count bumps.
 */
export interface DefinitionRecordPatch {
	displayName?: string;
	description?: string | null;
	category?: string | null;
	tags?: string[] | null;
	coverImage?: string | null;
	fileExt?: DefinitionFileExt;
	originalFilename?: string;
	maxHistory?: number;
	projectId?: string;
	computeServerId?: string | null;
	status?: DefinitionStatus;
	/** Ownership transfer — advances the owning user. Immutable fields don't appear here. */
	ownerId?: string;
}
