/**
 * Generic path-based blob storage provider.
 *
 * Implement with: local filesystem, S3, Firebase Storage, Supabase Storage, Azure Blob, etc.
 * Callers use path helpers (e.g. definitionPaths, orgPaths) to construct paths — the provider
 * only cares about storing and retrieving bytes at a given path.
 *
 * ## Authorization is the caller's responsibility
 *
 * Methods on this interface deliberately do NOT take a `RequestContext`. The path
 * itself names the resource (e.g. `definitions/{orgId}/{projectId}/{guid}/...`), so
 * to construct it the caller must already know the tenant-scoped IDs — which means
 * authorization happened upstream. The storage provider trusts the caller.
 *
 * Routes and services MUST authorize the operation against the appropriate access
 * rule (`@selva/platform/access`) BEFORE constructing the path and invoking the
 * store. Path construction is not a security boundary; the access check is.
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
