import { redirect } from '@sveltejs/kit';
import { isHttpError } from '@sveltejs/kit';
import type { AuthUser, RequestContext } from '@selvajs/platform';
import { SYSTEM_CONTEXT, emptyProfile } from '@selvajs/platform';
import { providers } from '$lib/server/providers.server';
import { getBootHealth } from '$lib/server/bootHealth.server';
import { bootstrapUserSession, wireHeaderAuthBootstrap } from '$lib/server/auth-bootstrap.server';
import {
	getRefreshToken,
	setSessionCookie,
	setRefreshCookie,
	clearRefreshCookie
} from '$lib/server/admin-auth.server';

// Lazy wiring of the forward-auth bootstrap policy. Runs once on the first
// real request rather than at module-import time so test files that import
// helpers from hooks.server.ts don't trigger provider lookups before their
// fake providers are installed. After the first call the flag flips and
// subsequent requests skip the no-op.
let headerAuthBootstrapWired = false;

// Env validation is owned by each provider's `fromEnv()` — the selected
// provider throws on missing vars (e.g. DATA_PATH for local, SUPABASE_URL for
// supabase) while `providers.server.ts` is loaded. No app-level check
// is needed here.

// Kick off boot-time integrity checks (currently: at-rest secret decryption
// for the local provider). Fire-and-forget — the promise is cached inside
// the module, and `/api/health` awaits it. Logs and degrades quietly; does
// not block request serving, because per-row tolerance in
// `LocalComputeServerStore` keeps pages rendering. See bootHealth.server.ts.
void getBootHealth();

/**
 * First-run state is a one-way transition (zero users → at least one user)
 * that lasts the lifetime of the deployment. After we've seen at least one
 * user, the answer is permanent — caching it eliminates a per-request DB
 * read for every admin/api hit. `firstRunResolved` never flips back to
 * false; that would require a destructive DB action well outside this
 * code's view.
 */
let firstRunResolved = false;

async function isFirstRun(): Promise<boolean> {
	if (firstRunResolved) return false;
	const usersPage = await providers.auth.listUsers({ limit: 1 });
	if (usersPage === null) {
		// Provider doesn't support listUsers (OIDC-only). The setup page uses
		// `permissions.hasInstanceAdmin` instead — first-run gating doesn't
		// apply to those deployments.
		firstRunResolved = true;
		return false;
	}
	if (usersPage.items.length === 0) return true;
	firstRunResolved = true;
	return false;
}

/**
 * Build a per-request context from an authenticated user. Resolves the
 * active-org membership and loads its OrgPermissions into the context.
 *
 * Active-org resolution:
 *  - Single tenancy: the deployment has exactly one org; pick it.
 *  - Multi tenancy: pick the first org the user is a member of. URL-prefix
 *    resolution (`/o/{slug}/...`) will replace this once routes are
 *    tenant-namespaced.
 *
 * `sessionToken` is forwarded as `adapterContext` so adapters that need the
 * upstream auth token (e.g. Supabase RLS) can pull it off the context.
 */
async function buildContext(
	user: AuthUser,
	sessionToken: string | undefined
): Promise<RequestContext> {
	let actingOrgId: string | undefined;
	let orgPermissions: RequestContext['orgPermissions'] = [];

	// Identity from the auth provider, authorization from the data layer.
	// Both reads run as SYSTEM_CONTEXT during request bootstrap (the user's
	// own ctx isn't built yet).
	const platformPermissions = await providers.data.permissions.getFor(SYSTEM_CONTEXT, user.id);

	// Single round-trip via `findUserMembership` (one indexed lookup against
	// `org_members`). Replaces the prior `listOrgs(50) + getOrgMember-per-org`
	// loop, which N+1'd on every authed request and silently truncated past
	// 50 orgs.
	const membership = await providers.data.orgs.findUserMembership(SYSTEM_CONTEXT, user.id);
	if (membership) {
		actingOrgId = membership.org.id;
		orgPermissions = membership.member.permissions;
	}

	if (!actingOrgId && platformPermissions.includes('instance_admin')) {
		// Instance admins without an explicit membership row fall back to the
		// first org so admin tooling stays usable before a switcher exists.
		const firstOrgPage = await providers.data.orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
		const firstOrg = firstOrgPage.items[0];
		if (firstOrg) actingOrgId = firstOrg.id;
	}

	return {
		userId: user.id,
		actingOrgId,
		platformPermissions,
		orgPermissions,
		adapterContext: sessionToken ? { sessionToken } : undefined
	};
}

// ============================================================================
// Route classification
// ============================================================================
//
// Auth gating is **deny-by-default**. Every request goes through `needsAuth`
// unless its path matches one of the explicit allowlists below. Adding a new
// top-level route is therefore safe — forgetting to update these lists makes
// it gated (a loud 401/redirect), not silently public.

/** Exact-match public pages — no session needed. */
const PUBLIC_PAGE_ROUTES: ReadonlySet<string> = new Set([
	'/', // landing — guests see it; authed users get redirected by +page.server.ts
	'/login',
	'/setup',
	'/accept-invite'
]);

/**
 * Public path *prefixes*. `/auth/` covers the OAuth start + callback flow
 * (the user has no session yet by definition). `/logout` is a form-action
 * page — the action destroys the session, then redirects.
 */
const PUBLIC_PATH_PREFIXES: readonly string[] = ['/auth/', '/logout'];

/**
 * API endpoints that must answer without a session — currently just the
 * load-balancer health probe. Anything added here must be safe to expose
 * to anonymous callers.
 */
const PUBLIC_API_ROUTES: ReadonlySet<string> = new Set(['/api/health']);

/**
 * Static-asset paths the SvelteKit/adapter-node serves directly. We
 * recognize them so the auth gate doesn't trip and we can apply
 * cache-control headers.
 */
const STATIC_ASSET_PREFIXES: readonly string[] = ['/_app/', '/favicon/'];
const STATIC_ASSET_PATHS: ReadonlySet<string> = new Set(['/favicon.svg', '/robots.txt']);

// Exported for tests so the auth-gate boundary has regression coverage —
// these predicates are the deny-by-default policy and a bug in either is
// security-relevant.
export function isStaticAsset(pathname: string): boolean {
	if (STATIC_ASSET_PATHS.has(pathname)) return true;
	return STATIC_ASSET_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isPublicRoute(pathname: string): boolean {
	if (PUBLIC_PAGE_ROUTES.has(pathname)) return true;
	if (PUBLIC_API_ROUTES.has(pathname)) return true;
	return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
	event.locals.providers = providers;

	if (!headerAuthBootstrapWired) {
		wireHeaderAuthBootstrap();
		headerAuthBootstrapWired = true;
	}

	const { pathname } = event.url;

	// Static assets bypass every gate below — no auth, no first-run check,
	// just resolve and let the cache-control headers below handle them.
	if (isStaticAsset(pathname)) {
		return applySecurityHeaders(await resolve(event), pathname);
	}

	// `/api/health` is a load-balancer probe — must answer without auth or
	// first-run gating. Short-circuit before any of the gates below run.
	if (pathname === '/api/health') {
		return applySecurityHeaders(await resolve(event), pathname);
	}

	const publicRoute = isPublicRoute(pathname);
	// Distinguish JSON API routes from page routes for response-shape choices
	// (401 JSON vs 303 redirect). Both `/api/*` and `/admin/api/*` qualify.
	const isJsonApiRoute = pathname.startsWith('/api/') || pathname.startsWith('/admin/api/');

	// On first run (no users yet), redirect non-public traffic to /setup so a
	// fresh deployment lands on the bootstrap flow rather than a dead login
	// page. Public routes (/, /login, /setup itself, /auth, /accept-invite,
	// /logout) pass through — /setup needs to render, /login is harmless to
	// show, /auth callback shouldn't fire on a fresh install. The answer is
	// cached: first-run is a one-way transition so subsequent requests skip
	// the listUsers DB hit entirely.
	if (!publicRoute) {
		if (await isFirstRun()) {
			if (isJsonApiRoute) {
				return applySecurityHeaders(
					new Response(JSON.stringify({ error: 'Setup required' }), {
						status: 503,
						headers: { 'Content-Type': 'application/json' }
					}),
					pathname
				);
			}
			redirect(303, '/setup');
		}
	}

	// Deny-by-default: any non-public, non-static path requires a valid
	// session. New top-level routes inherit "gated" automatically — the
	// only way to make something public is to add it to the lists above.
	const needsAuth = !publicRoute;
	if (needsAuth) {
		let token = event.cookies.get('admin_session') ?? '';
		let user = await providers.auth.verifyToken(token);

		// Session-refresh middleware: when the access token has expired but a
		// refresh token is present (Supabase OAuth flow), swap silently for a
		// fresh pair and rotate the cookies. Local/HMAC sessions never set a
		// refresh cookie, so this branch is a no-op there.
		if (!user) {
			const refreshToken = getRefreshToken(event.cookies);
			const oauth = providers.auth.oauth;
			if (refreshToken && oauth) {
				const refreshed = await oauth.refreshSession(refreshToken);
				if (refreshed) {
					setSessionCookie(event.cookies, refreshed.sessionToken);
					setRefreshCookie(event.cookies, refreshed.refreshToken);
					token = refreshed.sessionToken;
					user = await providers.auth.verifyToken(token);
				} else {
					// Refresh failed — clear the stale cookie so the next request
					// goes through the login flow cleanly.
					clearRefreshCookie(event.cookies);
				}
			}
		}

		// Forward-proxy fallback: providers that derive identity from trusted
		// upstream-proxy signals (Caddy forward_auth, oauth2-proxy, etc.) get
		// a chance to identify the request. See IProxyAuth for the trust
		// contract — the provider's README is responsible for the deployment
		// rules that make these signals trustworthy.
		if (!user && providers.auth.proxyAuth) {
			user = await providers.auth.proxyAuth.identifyFromHeaders(event.request.headers);
			// First-admin bootstrap for forward-auth deployments. The OAuth and
			// email-link callbacks call `bootstrapUserSession` themselves; the
			// proxy-auth path has no callback, so it runs here. `bootstrapUserSession`
			// is gated by `hasInstanceAdmin` internally and is a no-op once admin
			// exists, so this is safe to call on every authed request.
			if (user) await bootstrapUserSession(user);
		}

		if (!user) {
			if (isJsonApiRoute) {
				return applySecurityHeaders(
					new Response(JSON.stringify({ error: 'Unauthorized' }), {
						status: 401,
						headers: { 'Content-Type': 'application/json' }
					}),
					pathname
				);
			}
			redirect(303, `/login?redirectTo=${encodeURIComponent(pathname)}`);
		}

		// Make the authenticated user + profile + request context available to route loaders.
		// The profile lookup is one extra read per authed request; local reads `users.json`
		// already cached by the auth flow, Supabase will hit the user_profiles table.
		// Use SYSTEM_CONTEXT for the profile load — ctx itself isn't built yet,
		// and the user is loading their own profile during request bootstrap.
		// Local equivalent of Supabase's `handle_new_auth_user` trigger:
		// guarantees a `user-data.json` row exists for this user before any
		// data-layer read or write. Idempotent and cheap; Supabase makes it a
		// no-op (its DB trigger has already run).
		await providers.data.ensureUser(SYSTEM_CONTEXT, user.id);

		event.locals.user = user;
		event.locals.profile =
			(await providers.data.userProfile.getProfile(SYSTEM_CONTEXT, user.id)) ??
			emptyProfile(user.id);
		event.locals.ctx = await buildContext(user, token);
	} else {
		// Public page route (e.g. `/`): best-effort session attach. If a valid
		// session cookie is present we populate locals so the UI can reflect
		// the authed state (nav, user chip, etc.). Failure is silent — public
		// pages must keep rendering for guests. Skipped for public APIs and
		// the OAuth flow under `/auth/` since neither benefits from the lookup.
		const isPublicPage = PUBLIC_PAGE_ROUTES.has(pathname);
		const token = isPublicPage ? (event.cookies.get('admin_session') ?? '') : '';
		let user = token ? await providers.auth.verifyToken(token) : null;
		if (!user && isPublicPage && providers.auth.proxyAuth) {
			user = await providers.auth.proxyAuth.identifyFromHeaders(event.request.headers);
		}
		if (user) {
			await providers.data.ensureUser(SYSTEM_CONTEXT, user.id);
			event.locals.user = user;
			event.locals.profile =
				(await providers.data.userProfile.getProfile(SYSTEM_CONTEXT, user.id)) ??
				emptyProfile(user.id);
			event.locals.ctx = await buildContext(user, token);
		}
	}

	return applySecurityHeaders(await resolve(event), pathname);
};

// ============================================================================
// Response headers
// ============================================================================
//
// Applied to every response we produce — both successful resolves and the
// 401/503 short-circuits above. Cheap browser hardening that doesn't
// require UI verification:
//
//   - X-Content-Type-Options: nosniff — disables MIME sniffing.
//   - Referrer-Policy: strict-origin-when-cross-origin — strips the path
//     and query from cross-origin Referer headers; matches modern browser
//     defaults but pins the behavior in case the default ever drifts.
//   - Permissions-Policy: opt out of browser APIs we don't use, so XSS
//     can't enable them.
//   - HSTS in production only — locking dev (http://localhost) into HTTPS
//     would brick local development across the org.
//
// **Intentionally NOT set here** (deferred to the UI freeze):
//   - Content-Security-Policy + frame-ancestors. The selva app is built
//     for iframe embedding (per its own package description), so a strict
//     CSP needs UI-phase validation against real consumer sites before
//     it can ship.
//   - X-Frame-Options. Same iframe-embedding constraint.
function applySecurityHeaders(response: Response, pathname: string): Response {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
	);
	if (process.env.NODE_ENV === 'production') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	// Cache-control: hashed build assets are immutable; other static assets
	// get a short TTL.
	if (pathname.startsWith('/_app/')) {
		response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	} else if (
		pathname.startsWith('/favicon/') ||
		pathname === '/favicon.svg' ||
		pathname === '/robots.txt'
	) {
		response.headers.set('Cache-Control', 'public, max-age=604800');
	}

	return response;
}

export const handleError: import('@sveltejs/kit').HandleServerError = ({
	error,
	status,
	event
}) => {
	// For expected HTTP errors (thrown with error(4xx, message)), pass the message through as-is.
	// For unexpected errors, show a generic message to avoid leaking internals.
	if (isHttpError(error)) {
		return { message: error.body.message };
	}
	if (status === 404) {
		return { message: 'Page not found.' };
	}
	// Log enough context to diagnose without grepping: route, method, and the
	// underlying cause chain. SvelteKit's default logging drops `cause`, which
	// is where provider adapters tend to stash the real reason (Supabase
	// network error, fs EACCES, etc.).
	const cause = error instanceof Error && error.cause ? `\n  caused by: ${error.cause}` : '';
	console.error(
		`[Unhandled error] ${event.request.method} ${event.url.pathname}\n  ${error}${cause}`
	);
	return { message: 'An unexpected error occurred.' };
};
