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
}

/**
 * Lifecycle status of a definition record.
 * - 'pending' — metadata written, blob upload may be in flight or may have failed
 * - 'ready'   — blob is durably written and the record is visible to consumers
 *
 * List endpoints filter to 'ready' by default so callers never observe
 * half-written state. A janitor sweeps stale 'pending' records.
 */
export type DefinitionStatus = 'pending' | 'ready';

export interface DefinitionRecord {
	/** UUID v4 primary key */
	guid: string;
	/** UUID of the project that owns this definition */
	projectId: string;
	/** UUID of the user who created this definition */
	ownerId: string;
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
}
