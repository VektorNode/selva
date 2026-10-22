/** A file as a compute response carries it; {@link extractFilesFromComputeResponse} decodes it. */
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

/** A decoded or fetched file, ready to archive or hand to a caller. */
export type ProcessedFile = {
	/** Full filename including extension (e.g., "model.3dm") */
	fileName: string;
	/** File content as binary data (Uint8Array for decoded base64 or fetched binary) or text */
	content: Uint8Array | string;
	/** File path for archive organization (e.g., "subfolder/model.3dm") */
	path: string;
	/**
	 * The sanitized `subFolder`, kept apart from `path` because re-splitting a renamed duplicate
	 * path is ambiguous. `''` is the archive root; absent on a hand-built `ProcessedFile`.
	 */
	subFolder?: string;
	/** Carried through from {@link FileData}; absent when it had none, and on fetched files. */
	metadata?: Record<string, string>;
};

/** An external file to fetch over HTTP and package alongside the response's own files. */
export type FileBaseInfo = {
	/** Destination filename for the file in the archive or result set (e.g., "additional-data.json") */
	fileName: string;
	/** URL to fetch the file from. Must be accessible from the runtime environment */
	filePath: string;
	/** Optional directory path for archive organization (e.g., "extras/docs"). When omitted, file lands at archive root */
	subFolder?: string;
};
