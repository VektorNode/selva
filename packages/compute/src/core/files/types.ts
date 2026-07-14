/**
 * Raw file data from Grasshopper/Rhino Compute response, with metadata for processing.
 * Files are typically combined with additional files and packaged into a ZIP archive.
 * @see {@link extractFilesFromComputeResponse} for extraction from compute responses
 */
export type FileData = {
	/** Base filename without extension (e.g., "model") */
	fileName: string;
	/** File content, base64-encoded or plain string depending on isBase64Encoded flag */
	data: string;
	/** File extension including the dot (e.g., ".3dm", ".json"). Appended to fileName to create the full filename */
	fileType: string;
	/** Whether data is base64-encoded. If true, must be decoded to binary before use */
	isBase64Encoded: boolean;
	/** Directory path for archive organization (e.g., "subfolder/nested"). Empty string for root-level files */
	subFolder: string;
	/** Arbitrary metadata attached in Grasshopper. Not interpreted by compute; passed through for downstream consumers. May be absent on older payloads */
	metadata?: Record<string, string>;
};

/**
 * Normalized file ready for consumption or archival.
 * Unified intermediate format from FileData or FileBaseInfo, ready to be packaged into archives or returned to callers.
 */
export type ProcessedFile = {
	/** Full filename including extension (e.g., "model.3dm") */
	fileName: string;
	/** File content as binary data (Uint8Array for decoded base64 or fetched binary) or text */
	content: Uint8Array | string;
	/** File path for archive organization (e.g., "subfolder/model.3dm") */
	path: string;
};

/**
 * Reference to an external file to be fetched and included in file operations.
 * Specifies additional files (beyond compute response files) to fetch and process as ProcessedFile.
 * @see {@link fetchRemoteFiles} for how FileBaseInfo is fetched and converted
 */
export type FileBaseInfo = {
	/** Destination filename for the file in the archive or result set (e.g., "additional-data.json") */
	fileName: string;
	/** URL to fetch the file from. Must be accessible from the runtime environment */
	filePath: string;
	/** Optional directory path for archive organization (e.g., "extras/docs"). When omitted, file lands at archive root */
	subFolder?: string;
};
