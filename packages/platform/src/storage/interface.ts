/**
 * Generic path-based blob storage provider.
 *
 * Implement with: local filesystem, S3, Firebase Storage, Supabase Storage, Azure Blob, etc.
 * Callers use path helpers (e.g. definitionPaths, orgPaths) to construct paths — the provider
 * only cares about storing and retrieving bytes at a given path.
 */
export interface IStorageProvider {
	/** Load bytes at the given path. Returns null if the path does not exist. */
	get(path: string): Promise<Uint8Array | null>;

	/** Store bytes at the given path, creating or overwriting as needed. */
	put(path: string, data: Uint8Array, contentType?: string): Promise<void>;

	/** Delete a single file at the given path. No-op if it does not exist. */
	delete(path: string): Promise<void>;

	/**
	 * Delete all files whose path starts with the given prefix.
	 * Used to remove all files for an entity (e.g. all definition files for a guid).
	 */
	deletePrefix(prefix: string): Promise<void>;

	/**
	 * Return the public URL for a stored file.
	 * Local filesystem: a relative API path like "/api/files/definitions/{guid}/cover.webp".
	 * S3/CDN: a full CDN or signed URL.
	 */
	getPublicUrl(path: string): string;
}
