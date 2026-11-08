import { redirect, type RequestEvent } from '@sveltejs/kit';
import type { ServerInit } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { isApiError } from '@selvajs/server/api';
import type { AuthUser } from '@selvajs/platform';
import { SYSTEM_CONTEXT, emptyProfile } from '@selvajs/platform';
import {
	applySecurityHeaders,
	buildRequestContext,
	createHolderVerdictCache,
	createRouteClassifier,
	createSessionRefresher,
	createSessionResolver,
	isCrossSiteFormSubmission,
	resolveApiToken
} from '@selvajs/server/http';
import { renderThrown, resolveRequestId, REQUEST_ID_HEADER } from '@selvajs/server/logging';
import {
	providers,
	flag,
	getErrorReporter,
	getEventSink,
	getLogger,
	lazyLogger
} from '#lib/server/providers.server.js';
import { signInMaxAgeMs } from '#lib/server/signInMaxAge.server.js';
import { apiTokenCodec, apiTokenResolutions } from '#lib/server/apiTokens/token.server.js';
import { MCP_PATH } from '#lib/server/mcp/path.js';
import { readShareToken } from '#lib/server/shareLinks/resolve.server.js';
import { looksLikeShareToken } from '#lib/server/shareLinks/token.server.js';
import { requestMemo } from '#lib/server/requestMemo.server.js';
import { requestTiming } from '#lib/server/requestTiming.server.js';

const OAUTH_TOKEN_PATH = '/oauth/token';
const holderVerdicts = createHolderVerdictCache();
lazyLogger.info('Sign-in max age', { component: 'auth', maxAgeMs: signInMaxAgeMs ?? 'off' });
const refreshSession = createSessionRefresher(() => providers.auth.sessionRefresh, {
	signInMaxAgeMs,
	auth: () => providers.auth
});
import { getBootHealth } from '#lib/server/bootHealth.server.js';
import { checkConfigAtBoot } from '#lib/server/config/boot.server.js';
import { env } from '#lib/server/env.js';
import { deniesFraming } from '#lib/server/framing.js';
import { publicUrl } from '#lib/server/origin.js';
import { closeAllSolveEventStreams } from '#lib/server/solveEvents/sse.server.js';
import { findDeploymentDir, startUpdateOutcomeReconciler } from '#lib/server/selfUpdate.server.js';
import {
	bootstrapUserSession,
	wireHeaderAuthBootstrap
} from '#lib/server/auth-bootstrap.server.js';
import {
	getRefreshToken,
	setSessionCookie,
	setRefreshCookie,
	clearRefreshCookie
} from '#lib/server/admin-auth.server.js';

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

// Once at server start, never in tests that import this module for `handle`.
export const init: ServerInit = () => {
	checkConfigAtBoot();
	requestTiming.markBooted();
	// Not in dev: Vite owns the signals there, and HMR would stack a listener per reload.
	if (!dev) {
		process.once('SIGINT', closeAllSolveEventStreams);
		process.once('SIGTERM', closeAllSolveEventStreams);
	}
};

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

type SessionRows = Awaited<ReturnType<typeof readSessionRows>>;

interface Session {
	user: AuthUser;
	profile: App.Locals['profile'];
	ctx: App.Locals['ctx'];
}

/**
 * Profile, platform permissions and membership: independent and keyed only by the user id, so
 * they run together as SYSTEM_CONTEXT (`ctx` isn't built yet), and for a JWT session beside
 * `verifyToken`. Reads only: they run before the token is checked.
 */
function readSessionRows(userId: string) {
	return Promise.all([
		providers.data.userProfile.getProfile(SYSTEM_CONTEXT, userId),
		providers.data.permissions.getFor(SYSTEM_CONTEXT, userId),
		providers.data.orgs.findUserMembership(SYSTEM_CONTEXT, userId)
	]);
}

/**
 * The acting org is the user's first membership, or an instance admin's fallback. `ensureUser`
 * is the local equivalent of Supabase's `handle_new_auth_user` trigger, memoized per process.
 * The rows may have been read before it seeded a brand-new user's row: each fails soft to
 * empty, the correct state for a user with nothing yet.
 */
async function buildSession(
	user: AuthUser,
	[profile, platformPermissions, membership]: SessionRows,
	// Forwarded so adapters scoping by the upstream token (Supabase RLS) get it.
	sessionToken: string | undefined
): Promise<Session> {
	await ensureUserOnce(user.id);
	return {
		user,
		profile: profile ?? emptyProfile(user.id),
		ctx: await buildRequestContext(
			{ user, sessionToken, platformPermissions, membership: membership?.member ?? null },
			{ orgs: providers.data.orgs }
		)
	};
}

// No window: every request resolves its own session, since what it holds (stars, recent
// runs, memberships) changes under many writes that don't invalidate. Requests carrying one
// token at once still share one resolution, and a JWT's rows are read beside its check.
const sessions = createSessionResolver({
	verify: (token) => providers.auth.verifyToken(token),
	read: readSessionRows,
	build: buildSession
});

/** For a user identified without a session token (forward-auth headers). */
async function sessionFor(user: AuthUser, sessionToken: string | undefined): Promise<Session> {
	return buildSession(user, await readSessionRows(user.id), sessionToken);
}

function attachSession(event: RequestEvent, session: Session): void {
	event.locals.user = session.user;
	event.locals.profile = session.profile;
	event.locals.ctx = session.ctx;
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
	// readiness probe the post-update poller waits on across a restart. The v1
	// spec is public for the same reason `/docs/` is. `/mcp` gates itself: it needs a
	// key and passes it through to `/api/v1`, which authenticates every call.
	// OAuth discovery, registration and token exchange are called server-to-server
	// by MCP clients, with no session.
	publicApis: [
		'/api/health',
		'/api/health/ready',
		'/api/v1/openapi.json',
		MCP_PATH,
		'/.well-known/oauth-protected-resource',
		'/.well-known/oauth-protected-resource/mcp',
		'/.well-known/oauth-authorization-server',
		'/oauth/register',
		OAUTH_TOKEN_PATH
	],
	// Self-gating routes authorize each request themselves; the hook must not
	// deny them up front. `/api/files/[...path]` classifies each path against
	// the asset-class registry (public branding serves to anyone, org/project
	// assets 401 without a session). `/api/v1/solve-events` holds the SSE stream
	// (requires a session, checked in the route) and the Compute callback (no
	// session by nature — a per-solve bearer instead). The only other route that
	// authorizes a request itself is `/api/v1/compute` with a share token: see
	// `carriesShareToken`.
	//
	// No trailing slash on solve-events: the SSE route IS that path, with the
	// stream in a query param, so a trailing slash would deny the stream while
	// letting the callback (which has a solveId segment) through.
	selfGatingPrefixes: ['/api/files/', '/api/v1/solve-events'],
	// Static-asset paths SvelteKit/adapter-node serves directly.
	staticPrefixes: ['/_app/', '/favicon/'],
	staticPaths: ['/favicon.svg', '/robots.txt']
});

// Exported for tests: these predicates are the deny-by-default policy, and a
// bug in either is security-relevant.
export const { isStaticAsset, isSelfGatingApiRoute, isPublicRoute } = routeClassifier;

// The only two routes that honour a share token. A share link is meant to work
// without an account, so a request that carries one and has no session still
// reaches the route, which accepts or refuses the token itself. The page serves
// only the live pointer by token: a draft or version pick still needs a session.
const SHARE_TOKEN_API = '/api/v1/compute';
const SHARE_TOKEN_PAGE = /^\/library\/[^/]+$/;

function carriesShareToken(request: Request, url: URL): boolean {
	const onShareRoute =
		url.pathname === SHARE_TOKEN_API ||
		(SHARE_TOKEN_PAGE.test(url.pathname) &&
			url.searchParams.get('channel') !== 'draft' &&
			!url.searchParams.has('version'));
	return onShareRoute && readShareToken(request, url) !== null;
}

// Kept out of `redirectTo`: the login URL lands in access logs and browser history.
function withoutShareToken(url: URL): string {
	const query = new URLSearchParams(
		[...url.searchParams].filter(([key, value]) => !(key === 'token' && looksLikeShareToken(value)))
	).toString();
	return url.pathname + (query ? `?${query}` : '');
}

// Every request runs inside its read memo, so a layout and its page share repeated reads, and
// inside its timing store; static assets skip the timing.
export const handle: import('@sveltejs/kit/hooks').Handle = (input) => {
	const { event } = input;
	const run = () => requestMemo.run(event.request.method, () => gate(input));
	if (isStaticAsset(event.url.pathname)) return run();
	return requestTiming.timeRequest(
		{
			method: event.request.method,
			route: event.route.id ?? event.url.pathname,
			isDataRequest: event.isDataRequest
		},
		async () => run()
	);
};

const gate: import('@sveltejs/kit/hooks').Handle = async ({ event, resolve }) => {
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

	// SvelteKit's own check is off (vite.config.ts) because it can't exempt the
	// token endpoint or bearer requests; this is the same check with those exemptions.
	if (
		!dev &&
		isCrossSiteFormSubmission(event.request, {
			exemptPaths: [OAUTH_TOKEN_PATH],
			origin: publicUrl(event.url).origin
		})
	) {
		return applyResponseHeaders(
			new Response(`Cross-site ${event.request.method} form submissions are forbidden`, {
				status: 403
			}),
			pathname,
			requestId
		);
	}

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

	// A `selva_` key decides the request on its own: it never falls back to the
	// cookie, so a broken key can't quietly run as whoever is signed in.
	// `/mcp` carries a key but isn't under `/api/v1`, so the resolver would refuse it.
	const tokenResult =
		pathname === MCP_PATH
			? ({ kind: 'none' } as const)
			: await resolveApiToken(event.request, {
					codec: apiTokenCodec(),
					auth: providers.auth,
					data: providers.data,
					flag,
					holderVerdicts,
					signInMaxAgeMs,
					resolutionCache: apiTokenResolutions,
					log: event.locals.log
				});
	if (tokenResult.kind === 'rejected') {
		const { status, code, message } = tokenResult;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (status === 401) headers['WWW-Authenticate'] = 'Bearer error="invalid_token"';
		return applyResponseHeaders(
			new Response(JSON.stringify({ message, code }), { status, headers }),
			pathname,
			requestId
		);
	}
	if (tokenResult.kind === 'ok') {
		const { user, ctx, token } = tokenResult;
		event.locals.log = event.locals.log.child({ tokenId: token.id });
		event.locals.user = user;
		event.locals.ctx = ctx;
		event.locals.profile =
			(await providers.data.userProfile.getProfile(SYSTEM_CONTEXT, user.id)) ??
			emptyProfile(user.id);

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

	// Deny-by-default: any non-public, non-static path requires a valid session,
	// unless it carries a share token the route checks itself.
	const needsAuth = !publicRoute;
	if (needsAuth) {
		let token = event.cookies.get('admin_session') ?? '';
		let session = await sessions.resolve(token);

		// When the access token expired but a refresh token is present (Supabase
		// OAuth flow), swap silently for a fresh pair and rotate the cookies.
		// Local/HMAC sessions never set a refresh cookie, so this is a no-op there.
		if (!session) {
			const refreshToken = getRefreshToken(event.cookies);
			if (refreshToken && providers.auth.sessionRefresh) {
				const refreshed = await refreshSession(refreshToken);
				if (refreshed) {
					setSessionCookie(event.cookies, refreshed.sessionToken);
					setRefreshCookie(event.cookies, refreshed.refreshToken);
					token = refreshed.sessionToken;
					session = await sessions.resolve(token);
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
		let user = session?.user ?? null;
		if (!user && providers.auth.proxyAuth) {
			user = await providers.auth.proxyAuth.identifyFromHeaders(event.request.headers);
			// First-admin bootstrap for forward-auth deployments: OAuth and
			// email-link callbacks call `bootstrapUserSession` themselves, but the
			// proxy-auth path has no callback. Internally gated by `hasInstanceAdmin`
			// and a no-op once an admin exists, so safe on every authed request.
			if (user) await bootstrapUserSession(user);
		}

		if (!user && carriesShareToken(event.request, event.url)) {
			return applyResponseHeaders(await resolve(event), pathname, requestId);
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
			// With the query: an OAuth authorize request is nothing without it.
			redirect(303, `/login?redirectTo=${encodeURIComponent(withoutShareToken(event.url))}`);
		}

		attachSession(event, session ?? (await sessionFor(user, token)));
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
		const session = token ? await sessions.resolve(token) : null;
		let user = session?.user ?? null;
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
		if (user) attachSession(event, session ?? (await sessionFor(user, token)));
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
// Frame headers are the one route-dependent piece (`deniesFraming`).

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

export const handleError: import('@sveltejs/kit/hooks').HandleServerError = ({
	kind,
	error,
	event
}) => {
	// `error(...)` bodies already carry `code`/`fields`, so they reach the client as thrown.
	if (kind === 'app') return error;
	if (kind !== 'unknown') {
		return error.status === 404 ? { message: 'Page not found.', code: 'NOT_FOUND' } : error;
	}
	// Backstop only. `ApiError` reaching here means a page load called a guard
	// without going through `asHttpError()`.
	if (isApiError(error)) {
		return {
			status: error.status,
			message: error.message,
			code: error.code,
			fields: error.fields,
			details: error.details
		};
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
