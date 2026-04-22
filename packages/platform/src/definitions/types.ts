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

export interface DefinitionMeta {
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
	/** Original uploaded filename, kept for display only */
	originalFilename?: string;
}

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

/** Statuses visible to runners (end users with solve access) */
export const RUNNER_VISIBLE_STATUSES: DefinitionStatus[] = ['published'];

/** Statuses visible to project editors/owners */
export const EDITOR_VISIBLE_STATUSES: DefinitionStatus[] = ['draft', 'review', 'published', 'archived'];

export interface DefinitionRecord {
	/** UUID v4 primary key */
	guid: string;
	/** UUID of the project that owns this definition */
	projectId: string;
	/** UUID of the user who created this definition */
	ownerId: string;
	/** UUID of the user who last modified this definition */
	lastEditedBy?: string;
	/**
	 * Optional UUID of a specific compute server to use when solving.
	 * Falls back to the org default, then the platform default.
	 */
	computeServerId?: string;
	fileExt: DefinitionFileExt;
	meta: DefinitionMeta;
	/** File version history, newest first */
	history: HistoryEntry[];
	/** Maximum archived versions to keep. 0 = unlimited. */
	maxHistory: number;
	/** Lifecycle status. See DefinitionStatus. */
	status: DefinitionStatus;
	/** Total number of successful solve runs across all time. */
	runCount: number;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

/** Top-level fields that can be patched on an existing record. */
export interface DefinitionRecordPatch {
	meta?: Partial<DefinitionMeta>;
	fileExt?: DefinitionFileExt;
	maxHistory?: number;
	projectId?: string;
	computeServerId?: string | null;
	status?: DefinitionStatus;
	lastEditedBy?: string;
	/** Increments runCount by this value (always positive). */
	incrementRunCount?: number;
}
