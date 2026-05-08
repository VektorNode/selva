/**
 * Generic path-based blob storage. Implement with: local filesystem, S3,
 * Supabase Storage, Azure Blob, etc.
 *
 * **Authorization is the caller's responsibility.** Methods do NOT take a
 * `RequestContext` — the path itself names the resource, and constructing it
 * requires already-authorized scope. Routes/services MUST authorize against
 * `@selvajs/platform/access` BEFORE constructing the path.
 */
export interface IStorageProvider {
	/** Returns null if the path does not exist. */
	get(path: string): Promise<Uint8Array | null>;

	put(path: string, data: Uint8Array, contentType?: string): Promise<void>;

	/** No-op if the path does not exist. */
	delete(path: string): Promise<void>;

	/** Delete every file whose path starts with `prefix`. */
	deletePrefix(prefix: string): Promise<void>;

	/**
	 * Public URL for a stored file. Local: a relative API path; S3/CDN: a
	 * full or signed URL.
	 */
	getPublicUrl(path: string): string;
}
