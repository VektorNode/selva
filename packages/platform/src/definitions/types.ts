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
 * Lifecycle status. Internal state:
 * - 'pending' — metadata written, blob upload may be in flight or failed
 *
 * Editorial workflow (visible to project editors/owners):
 * - 'draft'     — work in progress, not visible to runners
 * - 'published' — live and visible to all with solve access
 *
 * List endpoints filter out 'pending' by default; a janitor sweeps stale ones.
 */
export type DefinitionStatus = 'pending' | 'draft' | 'published';

/**
 * Spec §6 — immutable snapshot of a definition's `.gh` file at a point in
 * time. New uploads create new versions; rollback re-points the parent's
 * `liveVersionId` at a previous version (it never mutates the version itself).
 */
export interface DefinitionVersion {
	id: string;
	definitionId: string;
	/** Monotonic integer starting at 1; never reused. */
	versionNumber: number;
	fileExt: DefinitionFileExt;
	/**
	 * Full storage key (e.g. `definitions/{guid}/versions/v3.gh`). Opaque to
	 * callers — the version row is the canonical location, not the path.
	 */
	fileKey: string;
	originalFilename?: string;
	uploadedBy: string;
	uploadedAt: string;
}

export interface DefinitionRecord {
	guid: string;
	projectId: string;
	/**
	 * Current owner (the "uploader" for commons projects). Separate from
	 * `createdBy` so ownership can be transferred without losing attribution.
	 */
	ownerId: string;
	createdBy: string;
	updatedBy: string;
	/** Falls back to the org default, then the platform default. */
	computeServerId?: string;
	displayName: string;
	description?: string;
	category?: string;
	tags?: string[];
	/**
	 * Provider-dependent public URL. The provider is responsible for ensuring
	 * it's safe to send to clients (CDN URL, signed S3, etc. — never an
	 * unsecured internal storage path).
	 */
	coverImage?: string;
	status: DefinitionStatus;
	runCount: number;
	/**
	 * Spec §6 channels. Both null only during the brief 'pending' window
	 * between metadata create and v1 upload; otherwise both reference live
	 * `DefinitionVersion` rows. Solving picks live by default; draft requires
	 * `canEditDefinition` (handled at the route layer).
	 */
	liveVersionId: string | null;
	draftVersionId: string | null;
	createdAt: string;
	updatedAt: string;
	/** Null = live. Reads filter non-null at the data-access layer. */
	deletedAt?: string | null;
}

/**
 * Patch omits immutable fields (`guid`, `createdBy`, `createdAt`) and
 * provider-managed ones (`updatedAt`, `updatedBy`, `deletedAt`, version
 * pointers). Use `setLiveVersion`/`setDraftVersion` for the latter.
 *
 * - `undefined` — leave unchanged
 * - `null` — clear (only on nullable fields below)
 * - value — set
 *
 * Use `incrementRunCount` for atomic +1 bumps instead of patching `runCount`.
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

/** Spec §6 — channel for solve dispatch. */
export type DefinitionChannel = 'live' | 'draft';
