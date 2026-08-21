import { redirect } from '@sveltejs/kit';
import { isHttpError } from '@sveltejs/kit';
import type { AuthUser, RequestContext } from '@selvajs/platform';
import { SYSTEM_CONTEXT, emptyProfile } from '@selvajs/platform';
import { applySecurityHeaders, createRouteClassifier } from '@selvajs/server/http';
import { renderThrown, resolveRequestId, REQUEST_ID_HEADER } from '@selvajs/server/logging';
import { providers, getErrorReporter, getEventSink, getLogger } from '$lib/server/providers.server';
import { getBootHealth } from '$lib/server/bootHealth.server';
import { env } from '$env/dynamic/private';
import { findDeploymentDir, startUpdateOutcomeReconciler } from '$lib/server/selfUpdate.server';
import { bootstrapUserSession, wireHeaderAuthBootstrap } from '$lib/server/auth-bootstrap.server';
import {
	getRefreshToken,
	setSessionCookie,
	setRefreshCookie,
	clearRefreshCookie
} from '$lib/server/admin-auth.server';

// Wired lazily on first real request, not at module import, so test files
// that import helpers from this module don't trigger provider lookups
// before their fake providers are installed.
let headerAuthBootstrapWired = false;

// Same lazy-on-first-request reasoning as headerAuthBootstrapWired above.
// Result is cached in bootHealth.server.ts; `/api/health` awaits that promise.
let bootHealthKicked = false;

// One-shot per process: a user landing on /login under forward-auth with no
// resolved identity is the clearest "headers didn't arrive" signal, worth a
// single log line rather than one per anonymous request.
let proxyAuthLoginMissWarned = false;

// Env validation is owned by each provider's `fromEnv()` (throws on missing
// vars, e.g. DATA_PATH for local, SUPABASE_URL for supabase) — no app-level
// check needed here.

// One-way transition (zero users → at least one). Once true, permanent —
// caching it skips a per-request listUsers DB read after the first user exists.
let firstRunResolved = false;

async function isFirstRun(): Promise<boolean> {
	if (firstRunResolved) return false;
	const usersPage = await providers.auth.listUsers({ limit: 1 });
	if (usersPage === null) {
		// OIDC-only provider, no listUsers support — the setup page falls back
		// to `permissions.hasInstanceAdmin` and first-run gating doesn't apply.
		firstRunResolved = true;
		return false;
	}
	if (usersPage.items.length === 0) return true;
	firstRunResolved = true;
	return false;
}

// `ensureUser` is idempotent and rows don't disappear mid-process, so once a
// user is ensured, subsequent requests skip the data-layer round-trip (local:
// a full `user-data.json` read+parse) for a `Set.has` check. Per-process only —
// a second instance just ensures the same user once itself; safe since the
// call is idempotent.
const ensuredUserIds = new Set<string>();

async function ensureUserOnce(userId: string): Promise<void> {
	if (ensuredUserIds.has(userId)) return;
	await providers.data.ensureUser(SYSTEM_CONTEXT, userId);
	ensuredUserIds.add(userId);
}

/**
 * Builds a per-request context from an authenticated user: resolves active-org
 * membership and its OrgPermissions.
 *
 * Active-org resolution: single tenancy picks the deployment's one org; multi
 * tenancy picks the first org the user belongs to (URL-prefix resolution via
 * `/o/{slug}/...` will replace this once routes are tenant-namespaced).
 *
 * Exported for tests: the fixture's `actAs()` mirrors this logic, so a direct
 * test pins the production function against drift.
 */
export async function buildContext(
	user: AuthUser,
	// Forwarded as `adapterContext` so adapters needing the upstream auth token
	// (e.g. Supabase RLS) can pull it off the context.
	sessionToken: string | undefined,
	// Pre-fetched by the hook so the four independent per-request reads
	// (ensureUser, getProfile, getFor, findUserMembership) run in one
	// `Promise.all` instead of serially, all as SYSTEM_CONTEXT since the
	// user's own ctx isn't built yet.
	platformPermissions: RequestContext['platformPermissions'],
	membership: Awaited<ReturnType<typeof providers.data.orgs.findUserMembership>>
): Promise<RequestContext> {
	let actingOrgId: string | undefined;
	let orgPermissions: RequestContext['orgPermissions'] = [];

	if (membership) {
		actingOrgId = membership.org.id;
		orgPermissions = membership.member.permissions;
	}

	if (!actingOrgId && platformPermissions.includes('instance_admin')) {
		// Instance admins without a membership row fall back to the first org so
		// admin tooling stays usable before a switcher exists. Depends on the
		// reads above (only fires with no membership + instance_admin), so it
		// stays sequential.
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
// Auth gating is **deny-by-default**: the classifier (mechanics in
// `@selvajs/server/http`) gates every request unless its path matches one of
// the allowlists below. Adding a route is safe by default — forgetting to
// list it makes it gated (401/redirect), not silently public. Named (not
// inlined into the classifier config) because the best-effort session attach
// below also needs it: public *pages* get locals populated for a signed-in
// user, public prefixes/APIs don't.
const PUBLIC_PAGE_ROUTES: ReadonlySet<string> = new Set([
	'/', // guests see the landing page; authed users get redirected by +page.server.ts
	'/login',
	'/setup',
	'/accept-invite'
]);

const routeClassifier = createRouteClassifier({
	publicPages: PUBLIC_PAGE_ROUTES,
	// `/auth/` is the OAuth start + callback flow (no session yet by
	// definition). `/logout` is a form action that destroys the session then
	// redirects. `/docs/` is the API reference — reads no tenant data, and
	// gating it would hide it from callers deciding whether to integrate.
	publicPrefixes: ['/auth/', '/logout', '/docs/'],
	// Must answer without a session: load-balancer liveness probe, and the
	// readiness probe the post-update poller waits on across a restart.
	publicApis: ['/api/health', '/api/health/ready'],
	// The blob proxy is *self-gating*: `/api/files/[...path]` classifies each
	// path against the asset-class registry and applies per-class auth itself
	// (public branding serves to anyone, org/project assets 401 without a
	// session). The hook must not deny it up front. Only `/api/*` prefix
	// allowed to carry its own authorization.
	selfGatingPrefix: '/api/files/',
	// Static-asset paths SvelteKit/adapter-node serves directly.
	staticPrefixes: ['/_app/', '/favicon/'],
	staticPaths: ['/favicon.svg', '/robots.txt']
});

// Exported for tests: these predicates are the deny-by-default policy, and a
// bug in either is security-relevant.
export const { isStaticAsset, isSelfGatingApiRoute, isPublicRoute } = routeClassifier;

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
	event.locals.providers = providers;

	// Bound once per request; every downstream `locals.log` record inherits
	// these fields. `event.url.pathname`, never `.search` — query strings carry
	// share tokens, and a log record outlives the token's usefulness to an attacker.
	const requestId = resolveRequestId(event.request.headers);
	event.locals.requestId = requestId;
	event.locals.log = getLogger().child({
		requestId,
		method: event.request.method,
		route: event.url.pathname
	});

	if (!headerAuthBootstrapWired) {
		wireHeaderAuthBootstrap();
		headerAuthBootstrapWired = true;
	}

	if (!bootHealthKicked) {
		bootHealthKicked = true;
		void getBootHealth();
		// Reconciles a self-update that was in flight when this process came up
		// into the audit log. No-op when no pending-update state file exists —
		// see selfUpdate.server.ts for the full lifecycle.
		const deploymentDir = findDeploymentDir(env);
		if (deploymentDir) {
			startUpdateOutcomeReconciler({
				deploymentDir,
				emit: (e) => getEventSink().emit(e),
				report: (err) => getErrorReporter().capture(err, { tags: { origin: 'selfUpdate' } })
			});
		}
	}

	const { pathname } = event.url;

	// Static assets bypass every gate below — no auth, no first-run check.
	if (isStaticAsset(pathname)) {
		return applyResponseHeaders(await resolve(event), pathname, requestId);
	}

	// Probes answer before any gate runs — a fresh deployment with no users yet
	// is still live and ready, and the first-run 503 below would tell a load
	// balancer (or the post-update poller) the opposite.
	if (pathname === '/api/health' || pathname === '/api/health/ready') {
		return applyResponseHeaders(await resolve(event), pathname, requestId);
	}

	const publicRoute = isPublicRoute(pathname);
	// All HTTP endpoints live under `/api/*` — distinguishes 401 JSON from a
	// 303 redirect.
	const isJsonApiRoute = pathname.startsWith('/api/');

	// On first run (no users yet), redirect non-public traffic to /setup so a
	// fresh deployment lands on the bootstrap flow instead of a dead login
	// page. Public routes pass through unchanged.
	if (!publicRoute) {
		if (await isFirstRun()) {
			if (isJsonApiRoute) {
				return applyResponseHeaders(
					new Response(JSON.stringify({ message: 'Setup required', code: 'SETUP_REQUIRED' }), {
						status: 503,
						headers: { 'Content-Type': 'application/json' }
					}),
					pathname,
					requestId
				);
			}
			redirect(303, '/setup');
		}
	}

	// Deny-by-default: any non-public, non-static path requires a valid session.
	const needsAuth = !publicRoute;
	if (needsAuth) {
		let token = event.cookies.get('admin_session') ?? '';
		let user = await providers.auth.verifyToken(token);

		// When the access token expired but a refresh token is present (Supabase
		// OAuth flow), swap silently for a fresh pair and rotate the cookies.
		// Local/HMAC sessions never set a refresh cookie, so this is a no-op there.
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
		// upstream-proxy signals (Caddy forward_auth, oauth2-proxy, etc.) get a
		// chance to identify the request. See IProxyAuth for the trust contract.
		if (!user && providers.auth.proxyAuth) {
			user = await providers.auth.proxyAuth.identifyFromHeaders(event.request.headers);
			// First-admin bootstrap for forward-auth deployments: OAuth and
			// email-link callbacks call `bootstrapUserSession` themselves, but the
			// proxy-auth path has no callback. Internally gated by `hasInstanceAdmin`
			// and a no-op once an admin exists, so safe on every authed request.
			if (user) await bootstrapUserSession(user);
		}

		if (!user) {
			if (isJsonApiRoute) {
				return applyResponseHeaders(
					new Response(
						JSON.stringify({
							message: 'Your session has expired. Sign in again to continue.',
							code: 'UNAUTHORIZED'
						}),
						{
							status: 401,
							headers: { 'Content-Type': 'application/json' }
						}
					),
					pathname,
					requestId
				);
			}
			redirect(303, `/login?redirectTo=${encodeURIComponent(pathname)}`);
		}

		// Four independent per-request reads, keyed only by `user.id` with no
		// dependency between them, so they run in one `Promise.all` — hook
		// latency becomes ~the slowest read instead of the sum of four. All run
		// as SYSTEM_CONTEXT since `ctx` isn't built yet.
		//
		//  1. ensureUser — local equivalent of Supabase's `handle_new_auth_user`
		//     trigger, guarantees a `user-data.json` row exists. Memoized
		//     per-process (`ensureUserOnce`); Supabase makes it a no-op.
		//  2. getProfile — display name / starred / recent runs.
		//  3. getFor — platform permissions.
		//  4. findUserMembership — acting org + org permissions.
		//
		// Racing ensureUser (a write-guard) against 2–4 is safe: on a brand-new
		// user's first request the reads may land before the row is seeded, but
		// each fails soft to empty (`null` profile → emptyProfile, `[]`
		// permissions, no membership) — the correct state for a user with nothing yet.
		const [, profile, platformPermissions, membership] = await Promise.all([
			ensureUserOnce(user.id),
			providers.data.userProfile.getProfile(SYSTEM_CONTEXT, user.id),
			providers.data.permissions.getFor(SYSTEM_CONTEXT, user.id),
			providers.data.orgs.findUserMembership(SYSTEM_CONTEXT, user.id)
		]);

		event.locals.user = user;
		event.locals.profile = profile ?? emptyProfile(user.id);
		event.locals.ctx = await buildContext(user, token, platformPermissions, membership);
	} else {
		// Public page route (e.g. `/`): best-effort session attach. If a valid
		// session cookie is present, populate locals so the UI reflects authed
		// state (nav, user chip). Failure is silent — public pages keep
		// rendering for guests. Also applies to the self-gating files proxy,
		// which needs `locals.ctx` when a session is present so org/project
		// assets resolve, while still rendering guests' public branding.
		const isPublicPage = PUBLIC_PAGE_ROUTES.has(pathname);
		const wantsSessionAttach = isPublicPage || isSelfGatingApiRoute(pathname);
		const token = wantsSessionAttach ? (event.cookies.get('admin_session') ?? '') : '';
		let user = token ? await providers.auth.verifyToken(token) : null;
		if (!user && wantsSessionAttach && providers.auth.proxyAuth) {
			user = await providers.auth.proxyAuth.identifyFromHeaders(event.request.headers);

			if (!user && pathname === '/login' && !proxyAuthLoginMissWarned) {
				proxyAuthLoginMissWarned = true;
				const proxyAuth = providers.auth.proxyAuth;
				const noHeaders = proxyAuth.hasNoIdentityHeaders(event.request.headers);
				const configured = proxyAuth.configuredHeaderNames.join(', ');
				if (noHeaders) {
					event.locals.log.warn(
						'/login was hit and NONE of the configured identity headers arrived. The ' +
							'forward-auth proxy is not reaching this process, or is not forwarding the ' +
							'configured headers. See the @selvajs/header-auth-provider README ' +
							'"Verification" section.',
						{ component: 'HeaderAuth', configuredHeaders: configured }
					);
				} else {
					event.locals.log.warn(
						'/login was hit but the UPN header was missing or the user is not allowlisted. ' +
							'Some headers arrived but identification still failed — check that the UPN ' +
							'header is populated and that the user has been added to header-allowlist.json.',
						{ component: 'HeaderAuth', configuredHeaders: configured }
					);
				}
			}
		}
		if (user) {
			// Same four-read parallelization as the gated path above (see there).
			const [, profile, platformPermissions, membership] = await Promise.all([
				ensureUserOnce(user.id),
				providers.data.userProfile.getProfile(SYSTEM_CONTEXT, user.id),
				providers.data.permissions.getFor(SYSTEM_CONTEXT, user.id),
				providers.data.orgs.findUserMembership(SYSTEM_CONTEXT, user.id)
			]);
			event.locals.user = user;
			event.locals.profile = profile ?? emptyProfile(user.id);
			event.locals.ctx = await buildContext(user, token, platformPermissions, membership);
		}
	}

	return applyResponseHeaders(await resolve(event), pathname, requestId);
};

// ============================================================================
// Response headers
// ============================================================================
//
// Applied to every response — successful resolves and the 401/503
// short-circuits above. The browser-hardening set (nosniff, Referrer-Policy,
// Permissions-Policy, HSTS in production) lives in `@selvajs/server/http` —
// see `applySecurityHeaders` there. Cache-control stays here: it encodes this
// app's asset layout.
//
// Frame headers are the one route-dependent piece. App routes must stay
// framable (embedding is what Selva-engine apps are for), but the operator
// surfaces below hold an authenticated admin session, where a framable page is
// a UI-redress attack.
const FRAME_DENIED_PREFIXES = ['/admin', '/setup', '/login'];

function deniesFraming(pathname: string): boolean {
	return FRAME_DENIED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function applyResponseHeaders(response: Response, pathname: string, requestId: string): Response {
	applySecurityHeaders(response, {
		hsts: process.env.NODE_ENV === 'production',
		denyFraming: deniesFraming(pathname)
	});

	// Echoed so a user reporting "request X failed" gives an operator the
	// exact key to grep logs with.
	response.headers.set(REQUEST_ID_HEADER, requestId);

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
	// Expected HTTP errors (thrown via error(4xx, body)) pass their structured
	// body through unchanged so `code`/`fields` reach the client. Unexpected
	// errors get a generic message to avoid leaking internals.
	if (isHttpError(error)) {
		const body = error.body as App.Error;
		return { message: body.message, code: body.code, fields: body.fields };
	}
	if (status === 404) {
		return { message: 'Page not found.', code: 'NOT_FOUND' };
	}
	// SvelteKit's default logging drops `cause`, which is where provider
	// adapters tend to stash the real reason (Supabase network error, fs
	// EACCES, etc.) — kept as a separate field so the message still groups
	// cleanly while the stack stays searchable.
	//
	// `locals.log` already carries requestId/method/route, but handleError can
	// fire before `handle` populates locals (a throw in an earlier hook), so
	// fall back to the root logger and re-state the fields.
	const log =
		event.locals.log ??
		getLogger().child({ method: event.request.method, route: event.url.pathname });
	log.error('Unhandled error', {
		component: 'handleError',
		status,
		err: renderThrown(error),
		cause: error instanceof Error && error.cause ? String(error.cause) : undefined
	});
	// Only reached for genuinely unexpected errors — intentional HTTP outcomes
	// (incl. the compute route's `apiError(500)` on a failed solve) are
	// `HttpError`s handled above. No-op unless SENTRY_DSN is configured.
	getErrorReporter().capture(error, {
		method: event.request.method,
		route: event.url.pathname,
		userId: event.locals.ctx?.userId || undefined,
		orgId: event.locals.ctx?.actingOrgId
	});
	return { message: 'An unexpected error occurred.', code: 'INTERNAL' };
};
