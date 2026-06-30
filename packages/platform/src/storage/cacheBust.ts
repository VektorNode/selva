/**
 * Append a cache-busting token to a stored-asset URL.
 *
 * Mutable blobs are overwritten **in place** (`IStorageProvider.put` is upsert),
 * so a re-upload keeps the same storage path — and therefore the same public
 * URL. A browser/CDN that cached the old bytes under that URL keeps serving them
 * until the TTL expires, which reads as "the replace didn't work". Appending a
 * token that changes only when the content changes gives each new version a
 * distinct URL (forcing a refetch) while letting unchanged assets stay cached.
 *
 * Generic over asset kind: the caller supplies the token from whatever it has
 * that tracks the blob's version — a content hash, the owning record's
 * `updatedAt`, a version counter. The serving route ignores the query string
 * (SvelteKit's `[...path]` param never includes it), so this is purely a
 * client-cache key and needs no route support.
 *
 * Empty/whitespace tokens are dropped (returns the URL unchanged) so a missing
 * token degrades to "no cache-bust" rather than `?v=`.
 */
export function withCacheBust(url: string, token: string | number | undefined | null): string {
	if (token === undefined || token === null) return url;
	const value = String(token).trim();
	if (value === '') return url;
	const sep = url.includes('?') ? '&' : '?';
	return `${url}${sep}v=${encodeURIComponent(value)}`;
}
