/**
 * Deny-by-default route classification. A request is gated unless its path
 * matches one of the allowlists supplied here, so forgetting to list a new
 * route makes it gated — a loud 401/redirect, not silently public.
 *
 * The pattern is reusable; the values are app policy, supplied by the consuming
 * app. Matching is plain exact/prefix string comparison: cheap enough for the
 * hooks hot path, and no regex to get wrong.
 */

export interface RouteClassifierConfig {
	/** Exact-match pages needing no session (e.g. `/`, `/login`). */
	publicPages?: Iterable<string>;
	/** Public path prefixes (e.g. `/auth/` — OAuth start and callback precede any session). */
	publicPrefixes?: readonly string[];
	/**
	 * Exact-match API endpoints that answer without a session (e.g. a
	 * load-balancer health probe). Anything listed here is exposed to anonymous
	 * callers.
	 */
	publicApis?: Iterable<string>;
	/**
	 * One prefix whose routes authorize each request themselves (e.g. a blob
	 * proxy classifying per asset path). These classify as public so the hook
	 * attaches a session best-effort and does not deny up front; the route makes
	 * the real decision. Keep it to ONE prefix — every other API route stays
	 * deny-by-default.
	 */
	selfGatingPrefix?: string;
	/** Static-asset prefixes the adapter serves directly (e.g. `/_app/`). */
	staticPrefixes?: readonly string[];
	/** Exact static-asset paths (e.g. `/favicon.svg`, `/robots.txt`). */
	staticPaths?: Iterable<string>;
}

export interface RouteClassifier {
	/** Matches `staticPaths`/`staticPrefixes`. These bypass auth gating entirely. */
	isStaticAsset(pathname: string): boolean;
	/** Matches `selfGatingPrefix`. The hook must not deny these — the route gates itself. */
	isSelfGatingApiRoute(pathname: string): boolean;
	/** Needs no session: a public page, API, prefix, or a self-gating route. */
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
