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

	/**
	 * Stores the bytes, replacing what is there, and returns the path they landed
	 * at. Images go through `transcodeImageIfNeeded` first: they are stored as WebP
	 * and a `.png` or similar path becomes `.webp`, so read back with the returned
	 * path. Throws `ProviderError(422)` for an image the transcoder refuses.
	 */
	put(path: string, data: Uint8Array, contentType?: string): Promise<string>;

	/** No-op if the path does not exist. */
	delete(path: string): Promise<void>;

	/**
	 * Delete every file under the directory `prefix`, so `a/b` does not reach
	 * `a/bc`. Throws on an empty prefix or `/`, which would name the whole store.
	 */
	deletePrefix(prefix: string): Promise<void>;

	/**
	 * Public URL for a stored file. Local: a relative API path; S3/CDN: a
	 * full or signed URL.
	 */
	getPublicUrl(path: string): string;
}
