/**
 * Definition provider interfaces — independently swappable.
 *
 * File storage and metadata storage are deliberately split so you can mix:
 *   - Filesystem files + Supabase DB metadata
 *   - S3 files + local JSON metadata
 *   - Everything through one backend (e.g. full Supabase)
 */

export type DefinitionFileExt = 'gh' | 'ghx';

/** File extensions accepted for Grasshopper definitions (with dot) */
export const GH_EXTENSIONS: string[] = ['.gh', '.ghx'];

/** Image extensions accepted for cover images (with dot) */
export const IMAGE_EXTENSIONS: string[] = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/** All accepted upload extensions */
export const ALLOWED_UPLOAD_EXTENSIONS: string[] = [...GH_EXTENSIONS, ...IMAGE_EXTENSIONS];

/** MIME types for image extensions */
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
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
	/** Path or URL to cover image, provider-dependent */
	coverImage?: string;
	/** Original uploaded filename, kept for display only */
	originalFilename?: string;
}

/**
 * A single entry in the file version history.
 * Stored by the meta provider; the actual bytes are stored by the file provider.
 */
export interface HistoryEntry {
	/**
	 * Provider-specific reference to the archived file.
	 * Filesystem: timestamped filename (e.g. "2024-01-15T10-30-45-123Z_definition.gh").
	 * S3 / Supabase: object key or storage path.
	 */
	ref: string;
	/** Original uploaded filename, for display purposes */
	originalName: string;
	/** ISO 8601 date of when the file was archived */
	archivedAt: string;
}

export interface DefinitionRecord {
	/** UUID v4 primary key */
	guid: string;
	fileExt: DefinitionFileExt;
	meta: DefinitionMeta;
	/** File version history, newest first */
	history: HistoryEntry[];
	/** Maximum archived versions to keep. 0 = unlimited. */
	maxHistory: number;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

/**
 * File storage provider: where .gh / .ghx binaries, archived versions, and preview images live.
 *
 * Implement with: local filesystem, S3, Supabase Storage, Azure Blob, etc.
 */
export interface IDefinitionFileProvider {
	/** Load the active Grasshopper definition binary. Returns null if not found. */
	getFile(guid: string): Promise<Uint8Array | null>;

	/** Load the preview image bytes. Returns null if no image exists. */
	getPreviewImage(guid: string): Promise<Uint8Array | null>;

	/**
	 * Load an archived file by its provider-specific ref.
	 * Used when reverting to a previous version.
	 */
	getArchivedFile(guid: string, ref: string): Promise<Uint8Array | null>;

	/** Store the active definition file. Overwrites any existing active file. */
	saveFile(guid: string, data: Uint8Array, ext: DefinitionFileExt): Promise<void>;

	/**
	 * Archive the current active file before replacing it.
	 * Returns a HistoryEntry (with provider-specific ref) to be saved by the meta provider.
	 * Returns null if there is no current active file to archive.
	 */
	archiveCurrentFile(guid: string, originalName: string): Promise<HistoryEntry | null>;

	/**
	 * Delete a specific archived version by its ref.
	 * Called when pruning history that exceeds maxHistory.
	 */
	deleteArchivedFile(guid: string, ref: string): Promise<void>;

	/** Store a preview image (expected to be WebP). */
	saveImage(guid: string, data: Uint8Array): Promise<void>;

	/**
	 * Returns the public URL for the stored cover image after a saveImage() call.
	 * Called immediately after saveImage() so the URL can be persisted in metadata.
	 * Filesystem: returns "/api/definitions/{guid}/image/cover.webp".
	 * S3/Supabase: returns the CDN or signed URL for the uploaded image.
	 */
	getCoverImageUrl(guid: string): string;

	/** Delete all files associated with a GUID (active file, archives, image). */
	deleteFiles(guid: string): Promise<void>;
}

/**
 * Metadata storage provider: where definition config, metadata, and file history live.
 *
 * Implement with: local JSON file, Supabase DB, DynamoDB, PostgreSQL, etc.
 */
export interface IDefinitionMetaProvider {
	/** List all definition records, sorted by displayName. */
	list(): Promise<DefinitionRecord[]>;

	/** Get a single record by GUID. Returns null if not found. */
	get(guid: string): Promise<DefinitionRecord | null>;

	/** Create a new definition record. */
	create(record: DefinitionRecord): Promise<void>;

	/** Merge a partial metadata update into an existing record. */
	update(guid: string, patch: Partial<DefinitionMeta>): Promise<void>;

	/**
	 * Prepend a new history entry and optionally prune old entries.
	 * The file provider has already archived the bytes; this just updates the metadata.
	 */
	addHistoryEntry(guid: string, entry: HistoryEntry): Promise<void>;

	/**
	 * Remove a history entry by ref (after the file provider has deleted the bytes).
	 */
	removeHistoryEntry(guid: string, ref: string): Promise<void>;

	/** Delete a definition record entirely. */
	delete(guid: string): Promise<void>;
}
