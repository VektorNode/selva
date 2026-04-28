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
 *
 * List endpoints filter `pending` by default (opt in via `ListOptions.includePending`).
 */
export type DefinitionStatus = 'pending' | 'draft' | 'published';

/**
 * Immutable snapshot of a definition's `.gh` file at a point in time. New
 * uploads create new versions; rollback re-points the parent's
 * `liveVersionId` (it never mutates the version itself).
 */
export interface DefinitionVersion {
	id: string;
	definitionId: string;
	/** Monotonic integer starting at 1; never reused. */
	versionNumber: number;
	fileExt: DefinitionFileExt;
	/** Full storage key. Opaque to callers. */
	fileKey: string;
	originalFilename?: string;
	uploadedBy: string;
	uploadedAt: string;
	/** Free-form note describing what changed in this version. */
	changeNote?: string;
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
	displayName: string;
	description?: string;
	category?: string;
	tags?: string[];
	/** Provider-dependent public URL — must be safe to send to clients. */
	coverImage?: string;
	status: DefinitionStatus;
	solveCount: number;
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
	status?: DefinitionStatus;
	/** Ownership transfer. */
	ownerId?: string;
}

/** Channel for solve dispatch. */
export type DefinitionChannel = 'live' | 'draft';
