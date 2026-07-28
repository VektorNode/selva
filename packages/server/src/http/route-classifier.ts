/**
 * Deny-by-default route classification. Every request is gated unless its
 * path matches one of the explicit allowlists supplied here — so adding a new
 * top-level route is safe: forgetting to update the lists makes it gated (a
 * loud 401/redirect), not silently public.
 *
 * The *pattern* is reusable; the *values* are app policy — a consuming app
 * supplies its own route sets. All matching is plain exact/prefix string
 * comparison: cheap enough for the hooks hot path, and no regex to get wrong.
 */

export interface RouteClassifierConfig {
	/** Exact-match public pages — no session needed (e.g. `/`, `/login`). */
	publicPages?: Iterable<string>;
	/**
	 * Public path prefixes (e.g. `/auth/` for OAuth start + callback — the
	 * user has no session yet by definition).
	 */
	publicPrefixes?: readonly string[];
	/**
	 * Exact-match API endpoints that must answer without a session (e.g. a
	 * load-balancer health probe). Anything added here must be safe to expose
	 * to anonymous callers.
	 */
	publicApis?: Iterable<string>;
	/**
	 * A single prefix whose routes apply their own per-request authorization
	 * (e.g. a blob proxy classifying each asset path). The hook must NOT deny
	 * these up front; they classify as public (best-effort session attach) and
	 * the route makes the real decision. Keep this to ONE prefix — every other
	 * API route stays deny-by-default.
	 */
	selfGatingPrefix?: string;
	/** Static-asset path prefixes the adapter serves directly (e.g. `/_app/`). */
	staticPrefixes?: readonly string[];
	/** Exact static-asset paths (e.g. `/favicon.svg`, `/robots.txt`). */
	staticPaths?: Iterable<string>;
}

export interface RouteClassifier {
	/** Static assets bypass auth gating; callers may add cache headers. */
	isStaticAsset(pathname: string): boolean;
	/** True for paths under `selfGatingPrefix` — the route gates itself. */
	isSelfGatingApiRoute(pathname: string): boolean;
	/** True when the path needs no session: pages, APIs, prefixes, self-gating. */
	isPublicRoute(pathname: string): boolean;
}

export function createRouteClassifier(config: RouteClassifierConfig): RouteClassifier {
	const publicPages = new Set(config.publicPages ?? []);
	const publicPrefixes = config.publicPrefixes ?? [];
	const publicApis = new Set(config.publicApis ?? []);
	const selfGatingPrefix = config.selfGatingPrefix;
	const staticPrefixes = config.staticPrefixes ?? [];
	const staticPaths = new Set(config.staticPaths ?? []);

	function isStaticAsset(pathname: string): boolean {
		if (staticPaths.has(pathname)) return true;
		return staticPrefixes.some((p) => pathname.startsWith(p));
	}

	function isSelfGatingApiRoute(pathname: string): boolean {
		return selfGatingPrefix !== undefined && pathname.startsWith(selfGatingPrefix);
	}

	function isPublicRoute(pathname: string): boolean {
		if (publicPages.has(pathname)) return true;
		if (publicApis.has(pathname)) return true;
		if (isSelfGatingApiRoute(pathname)) return true;
		return publicPrefixes.some((p) => pathname.startsWith(p));
	}

	return { isStaticAsset, isSelfGatingApiRoute, isPublicRoute };
}
