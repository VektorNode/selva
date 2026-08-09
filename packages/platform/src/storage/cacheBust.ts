/**
 * Appends a cache-busting token to a stored-asset URL.
 *
 * `IStorageProvider.put` upserts, so a re-upload keeps the same storage path
 * and public URL — a browser/CDN caching the old bytes under that URL keeps
 * serving them past the TTL, which reads as "the replace didn't work."
 * Appending a token that only changes with the content gives each version a
 * distinct URL, forcing a refetch, while unchanged assets stay cached.
 *
 * Generic over asset kind — pass whatever tracks the blob's version (content
 * hash, `updatedAt`, a counter). The serving route ignores the query string
 * (SvelteKit's `[...path]` param never includes it), so this needs no route
 * support.
 *
 * Empty/whitespace tokens return the URL unchanged, so a missing token
 * degrades to "no cache-bust" rather than `?v=`.
 */
export function withCacheBust(url: string, token: string | number | undefined | null): string {
	if (token === undefined || token === null) return url;
	const value = String(token).trim();
	if (value === '') return url;
	const sep = url.includes('?') ? '&' : '?';
	return `${url}${sep}v=${encodeURIComponent(value)}`;
}
