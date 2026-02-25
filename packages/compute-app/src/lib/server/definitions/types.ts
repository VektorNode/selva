/**
 * Core interfaces for definition loading - decoupled from implementation
 */

export type DefinitionFileType = 'gh' | 'ghx';

export interface HistoryEntry {
	/** Archived filename with timestamp prefix (used for revert API calls) */
	filename: string;
	/** Original file name without timestamp prefix */
	originalName: string;
	/** ISO 8601 date string of when the file was archived */
	date: string;
}

export interface DefinitionMetadata {
	displayName: string;
	description?: string;
	coverImage?: string;
	category?: string;
	tags?: string[];
	/** Stable filename on disk: always "definition.gh" or "definition.ghx" */
	file?: string;
	/** Original uploaded filename, kept for display purposes only */
	originalFilename?: string;
	/** Ordered list of archived versions, newest first */
	history?: HistoryEntry[];
	/** Maximum number of archived versions to keep. 0 or undefined = keep all */
	maxHistory?: number;
}

export interface Definition extends DefinitionMetadata {
	/** The GUID - config key and folder name */
	guid: string;
	/** Same as `file` field - the active filename */
	filename: string;
	fileType: DefinitionFileType;
}

export interface IDefinitionLoader {
	/**
	 * Get all available definitions
	 */
	listDefinitions(): Promise<Definition[]>;

	/**
	 * Get metadata for a specific definition.
	 * @param identifier - GUID or filename (e.g. "table_example.gh")
	 */
	getMetadata(identifier: string): Promise<DefinitionMetadata>;

	/**
	 * Load a definition file as binary data.
	 * @param identifier - GUID or filename
	 */
	loadDefinition(identifier: string): Promise<Uint8Array>;

	/**
	 * Get a URL for a definition (may be local path or remote URL).
	 * @param identifier - GUID or filename
	 */
	getDefinitionUrl(identifier: string): Promise<string>;
}

export interface DefinitionsConfig {
	definitions: Record<string, DefinitionMetadata>;
}

export interface FileInput {
	name: string;
	data: ArrayBuffer;
}

export interface CreateDefinitionInput {
	displayName: string;
	description?: string;
	coverImage?: string;
	category?: string;
	tags?: string[];
	file: FileInput;
}

/**
 * Write-capable extension of IDefinitionLoader.
 * Implementations must handle all filesystem mutations so route files stay pure.
 */
export interface IDefinitionStore extends IDefinitionLoader {
	/** Read the raw config file (useful for admin page load) */
	readConfig(): Promise<DefinitionsConfig>;

	/** Get archived file history for a GUID */
	getFileHistory(guid: string): Promise<HistoryEntry[]>;

	/** Create a new definition; returns { guid, filename, coverImage? } */
	createDefinition(
		input: CreateDefinitionInput,
		imageFile?: FileInput | null
	): Promise<{ guid: string; filename: string; coverImage?: string }>;

	/** Merge a metadata patch into an existing definition */
	updateMetadata(guid: string, patch: Partial<DefinitionMetadata>): Promise<void>;

	/** Delete a definition's folder and config entry */
	deleteDefinition(guid: string): Promise<void>;

	/** Replace the active GH file, archiving the previous one */
	replaceFile(guid: string, file: FileInput): Promise<string>;

	/** Restore an archived file as the active file, archiving the current one */
	revertFile(guid: string, archivedFilename: string): Promise<string>;

	/** Save a cover image into the GUID folder and update config */
	saveImage(guid: string, image: FileInput): Promise<string>;

	/** Read image bytes from the GUID folder (for serving) */
	readImage(guid: string, filename: string): Promise<Buffer>;
}
