import { env } from '#lib/server/env.js';

/**
 * The request's URL as the browser sees it. adapter-node 6 dropped `ORIGIN` and builds
 * `event.url` from the `Host` header with an assumed `https`, so on plain HTTP, or behind a
 * proxy that rewrites `Host`, links and the CSRF check would use the wrong origin. Operators
 * already set `ORIGIN` for exactly those setups, so it wins here as it did in the adapter.
 */
export function publicUrl(url: URL): URL {
	if (!env.ORIGIN) return url;
	// No `url.hash`: the server never receives one, and SvelteKit's request URL throws on access.
	return new URL(url.pathname + url.search, env.ORIGIN);
}
