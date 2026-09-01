/**
 * Raw file data from Grasshopper/Rhino Compute response, with metadata for processing.
 * Files are typically combined with additional files and packaged into a ZIP archive.
 * @see {@link extractFilesFromComputeResponse} for extraction from compute responses
 */
export type FileData = {
	/** Base filename without extension (e.g., "model") */
	fileName: string;
	/** File content, base64-encoded or plain string depending on `isBase64Encoded` */
	data: string;
	/** File extension including the dot (e.g., ".3dm", ".json"), appended to `fileName` */
	fileType: string;
	/** Whether `data` is base64-encoded and must be decoded to binary before use */
	isBase64Encoded: boolean;
	/** Directory path for archive organization (e.g., "subfolder/nested"); empty for root-level files */
	subFolder: string;
	/** Arbitrary metadata attached in Grasshopper, passed through uninterpreted; may be absent on older payloads */
	metadata?: Record<string, string>;
};

/**
 * Normalized file ready for consumption or archival.
 * Unified intermediate format from FileData or FileBaseInfo, ready to be packaged into archives or returned to callers.
 */
export type ProcessedFile = {
	/** Full filename including extension (e.g., "model.3dm") */
	fileName: string;
	/** Decoded base64/fetched binary as `Uint8Array`, or plain text */
	content: Uint8Array | string;
	/** File path for archive organization (e.g., "subfolder/model.3dm") */
	path: string;
	/**
	 * The sanitized `subFolder` this file came from, separately from `path`.
	 *
	 * `path` fuses folder and name for the archive, and a consumer that stores files
	 * itself (rather than zipping them) otherwise has to re-split it, which is
	 * ambiguous once a duplicate path has been renamed. `''` means archive root;
	 * absent means the producer did not record one (hand-built `ProcessedFile`s).
	 */
	subFolder?: string;
	/**
	 * Grasshopper-authored metadata carried through from {@link FileData}. Absent when
	 * the source item had none, or for files fetched via {@link FileBaseInfo} (an
	 * external URL has no GH metadata).
	 */
	metadata?: Record<string, string>;
};

/**
 * Reference to an external file to be fetched and included in file operations.
 * Specifies additional files (beyond compute response files) to fetch and process as ProcessedFile.
 * @see {@link fetchRemoteFiles} for how FileBaseInfo is fetched and converted
 */
export type FileBaseInfo = {
	/** Destination filename for the file in the archive or result set (e.g., "additional-data.json") */
	fileName: string;
	/** URL to fetch the file from; must be reachable from the runtime environment */
	filePath: string;
	/** Optional directory path for archive organization (e.g., "extras/docs"); omitted means archive root */
	subFolder?: string;
};
