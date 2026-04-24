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

export interface HistoryEntry {
	/**
	 * UUID + sanitized filename suffix; full storage path built via
	 * `definitionPaths.archive(guid, ref)`.
	 */
	ref: string;
	originalName: string;
	archivedAt: string;
	uploadedBy?: string;
	note?: string;
}

/**
 * Lifecycle status. Internal state:
 * - 'pending' — metadata written, blob upload may be in flight or failed
 *
 * Editorial workflow (visible to project editors/owners):
 * - 'draft'     — work in progress, not visible to runners
 * - 'review'    — submitted for review, read-only for editors
 * - 'published' — live and visible to all with solve access
 * - 'archived'  — retired, hidden from runners but preserved
 *
 * List endpoints filter out 'pending' by default; a janitor sweeps stale ones.
 */
export type DefinitionStatus = 'pending' | 'draft' | 'review' | 'published' | 'archived';

/**
 * Immutable snapshot of a definition's `.gh` file at a point in time.
 * Scaffold only — no upload/publish flow consumes versions yet. Spec §6.
 */
export interface DefinitionVersion {
	id: string;
	definitionId: string;
	/** Monotonic integer starting at 1, incrementing on each upload. */
	versionNumber: number;
	/** Storage key — opaque to the domain layer. */
	fileKey: string;
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
	fileExt: DefinitionFileExt;
	originalFilename?: string;
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
	/** Newest first. */
	history: HistoryEntry[];
	/** 0 = unlimited. */
	maxHistory: number;
	status: DefinitionStatus;
	runCount: number;
	/**
	 * Versioning scaffold. Both null until the upload/publish flow lands;
	 * legacy paths keep writing to `history[]` in the meantime. Spec §6.
	 */
	liveVersionId?: string | null;
	draftVersionId?: string | null;
	createdAt: string;
	updatedAt: string;
	/** Null = live. Reads filter non-null at the data-access layer. */
	deletedAt?: string | null;
}

/**
 * Patch omits immutable fields (`guid`, `createdBy`, `createdAt`) and
 * provider-managed ones (`updatedAt`, `updatedBy`, `history`, `deletedAt`).
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
	fileExt?: DefinitionFileExt;
	originalFilename?: string;
	maxHistory?: number;
	projectId?: string;
	computeServerId?: string | null;
	status?: DefinitionStatus;
	/** Ownership transfer. */
	ownerId?: string;
}
