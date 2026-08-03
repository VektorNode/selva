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

// Lazy wiring of the forward-auth bootstrap policy. Runs once on the first
// real request rather than at module-import time so test files that import
// helpers from hooks.server.ts don't trigger provider lookups before their
// fake providers are installed. After the first call the flag flips and
// subsequent requests skip the no-op.
let headerAuthBootstrapWired = false;

// Same module-import-vs-test-import concern as above: kick off the
// boot-time integrity check on the first real request rather than at
// module load, so test files that import the pure route-classification
// helpers from this module don't trip provider lookups before their
// fake providers are wired. The result is still cached inside
// bootHealth.server.ts after the first call, and `/api/health` awaits
// the same promise. See bootHealth.server.ts.
let bootHealthKicked = false;

// One-shot diagnostic flag for the `/login` page specifically. A user
// landing on /login under a forward-auth deployment is the loudest signal
// that headers didn't make it through — the per-process provider warning
// covers the very first miss, this one targets the diagnostic moment the
// operator is most likely to observe.
let proxyAuthLoginMissWarned = false;

// Env validation is owned by each provider's `fromEnv()` — the selected
// provider throws on missing vars (e.g. DATA_PATH for local, SUPABASE_URL for
// supabase) while `providers.server.ts` is loaded. No app-level check
// is needed here.

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
 * Ids of users already registered in the data layer this process. `ensureUser`
 * is idempotent and rows don't disappear mid-process, so once we've ensured a
 * user we can skip the call on every subsequent request from that user —
 * turning a per-request data-layer round-trip (local: a full `user-data.json`
 * read+parse) into a `Set.has` check. Same one-way-flag reasoning as
 * `firstRunResolved`.
 *
 * Per-process (not shared across instances). That's correct: `ensureUser` is
 * idempotent, so a second instance simply ensures the same user once itself —
 * no cross-instance invariant depends on a single call.
 */
const ensuredUserIds = new Set<string>();

async function ensureUserOnce(userId: string): Promise<void> {
	if (ensuredUserIds.has(userId)) return;
	await providers.data.ensureUser(SYSTEM_CONTEXT, userId);
	ensuredUserIds.add(userId);
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
 *
 * Exported for tests: the fixture's `actAs()` mirrors this logic, so a direct
 * test pins the production function against drift (audit T2/Q4).
 */
export async function buildContext(
	user: AuthUser,
	sessionToken: string | undefined,
	// Pre-fetched by the hook so the four independent per-request reads
	// (ensureUser, getProfile, getFor, findUserMembership) run in one
	// `Promise.all` instead of serially. Identity from the auth provider,
	// authorization from the data layer — both fetched as SYSTEM_CONTEXT during
	// request bootstrap (the user's own ctx isn't built yet).
	platformPermissions: RequestContext['platformPermissions'],
	membership: Awaited<ReturnType<typeof providers.data.orgs.findUserMembership>>
): Promise<RequestContext> {
	let actingOrgId: string | undefined;
	let orgPermissions: RequestContext['orgPermissions'] = [];

	// `membership` came from `findUserMembership` — one indexed lookup against
	// `org_members` (replaces the prior `listOrgs(50) + getOrgMember-per-org`
	// N+1).
	if (membership) {
		actingOrgId = membership.org.id;
		orgPermissions = membership.member.permissions;
	}

	if (!actingOrgId && platformPermissions.includes('instance_admin')) {
		// Instance admins without an explicit membership row fall back to the
		// first org so admin tooling stays usable before a switcher exists. This
		// read genuinely depends on the two above (only fires when there's no
		// membership and the user is an instance admin), so it stays sequential.
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
// the explicit allowlists below. Adding a new top-level route is therefore
// safe — forgetting to update these lists makes it gated (a loud
// 401/redirect), not silently public. The VALUES here are this app's policy.
// Named (not inlined into the classifier config) because the best-effort
// session attach below also needs it: public *pages* get locals populated for
// a signed-in user, public prefixes/APIs don't.
const PUBLIC_PAGE_ROUTES: ReadonlySet<string> = new Set([
	'/', // landing — guests see it; authed users get redirected by +page.server.ts
	'/login',
	'/setup',
	'/accept-invite'
]);

const routeClassifier = createRouteClassifier({
	publicPages: PUBLIC_PAGE_ROUTES,
	// `/auth/` covers the OAuth start + callback flow (the user has no session
	// yet by definition). `/logout` is a form-action page — the action destroys
	// the session, then redirects.
	publicPrefixes: ['/auth/', '/logout'],
	// Endpoints that must answer without a session — currently just the
	// load-balancer health probe. Anything added here must be safe to expose
	// to anonymous callers.
	publicApis: ['/api/health'],
	// The blob proxy is *self-gating*: `/api/files/[...path]` classifies every
	// path against the asset-class registry and applies per-class auth itself —
	// public branding (logo/favicon) serves to anyone, while org/project assets
	// 401 when no session is attached. So the hook must NOT deny it up front;
	// the route makes the real decision. This is the ONLY `/api/*` prefix
	// allowed to carry its own authorization.
	selfGatingPrefix: '/api/files/',
	// Static-asset paths SvelteKit/adapter-node serves directly — recognized so
	// the auth gate doesn't trip and cache-control headers can apply.
	staticPrefixes: ['/_app/', '/favicon/'],
	staticPaths: ['/favicon.svg', '/robots.txt']
});

// Exported for tests so the auth-gate boundary has regression coverage —
// these predicates are the deny-by-default policy and a bug in either is
// security-relevant.
export const { isStaticAsset, isSelfGatingApiRoute, isPublicRoute } = routeClassifier;

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
	event.locals.providers = providers;

	// Correlation, bound once per request. Every downstream `locals.log` record
	// inherits these fields, so no call site has to thread a request id — which
	// is precisely what the pre-pino `console.*` calls could not do.
	// `event.url.pathname` (never `event.url.search`): query strings carry share
	// tokens, and a log record outlives the token's usefulness to an attacker.
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
		// If a self-update was in flight when this process came up, reconcile its
		// outcome into the audit log (system.update.finished / rolled_back /
		// failed). No-op when no pending-update state file exists — see
		// selfUpdate.server.ts for the full lifecycle.
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

	// Static assets bypass every gate below — no auth, no first-run check,
	// just resolve and let the cache-control headers below handle them.
	if (isStaticAsset(pathname)) {
		return applyResponseHeaders(await resolve(event), pathname, requestId);
	}

	// `/api/health` is a load-balancer probe — must answer without auth or
	// first-run gating. Short-circuit before any of the gates below run.
	if (pathname === '/api/health') {
		return applyResponseHeaders(await resolve(event), pathname, requestId);
	}

	const publicRoute = isPublicRoute(pathname);
	// Distinguish JSON API routes from page routes for response-shape choices
	// (401 JSON vs 303 redirect). All HTTP endpoints live under `/api/*`.
	const isJsonApiRoute = pathname.startsWith('/api/');

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

		// Make the authenticated user + profile + request context available to
		// route loaders. Four independent per-request reads, all keyed only by
		// `user.id` with no data dependency between them, so they run in one
		// `Promise.all` — hook latency becomes ~the slowest read instead of the
		// sum of four. All run as SYSTEM_CONTEXT: `ctx` isn't built yet, and the
		// user is bootstrapping their own request.
		//
		//  1. ensureUser — local equivalent of Supabase's `handle_new_auth_user`
		//     trigger: guarantees a `user-data.json` row exists. Idempotent, and
		//     memoized per-process (`ensureUserOnce`) so it's a `Set.has` after
		//     the first request from a given user. Supabase makes it a no-op.
		//  2. getProfile — display name / starred / recent runs.
		//  3. getFor — platform permissions (authorization).
		//  4. findUserMembership — acting org + org permissions.
		//
		// Racing ensureUser (a write-guard) against reads 2–4 is safe: on the
		// very first request from a brand-new user the reads may land before the
		// row is seeded, but every read fails soft to empty — `null` profile
		// (→ emptyProfile), `[]` permissions, no membership — which is exactly
		// the correct state for a user who has nothing yet.
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
		// session cookie is present we populate locals so the UI can reflect
		// the authed state (nav, user chip, etc.). Failure is silent — public
		// pages must keep rendering for guests. Skipped for public APIs and
		// the OAuth flow under `/auth/` since neither benefits from the lookup.
		// Best-effort attach applies to public *pages* and to the self-gating
		// files proxy: the latter needs `locals.ctx` populated when a session is
		// present so org/project assets resolve, while still rendering for guests
		// (who get only public branding).
		const isPublicPage = PUBLIC_PAGE_ROUTES.has(pathname);
		const wantsSessionAttach = isPublicPage || isSelfGatingApiRoute(pathname);
		const token = wantsSessionAttach ? (event.cookies.get('admin_session') ?? '') : '';
		let user = token ? await providers.auth.verifyToken(token) : null;
		if (!user && wantsSessionAttach && providers.auth.proxyAuth) {
			user = await providers.auth.proxyAuth.identifyFromHeaders(event.request.headers);

			// Diagnostic: a user landing on /login under a forward-auth
			// deployment without a resolved identity is the canonical
			// "headers didn't make it through" symptom. Log once per process
			// so operators see a clear signal during deploy verification
			// without spamming on every anonymous request.
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
			// Same four-read parallelization as the gated path above.
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
// Applied to every response we produce — both successful resolves and the
// 401/503 short-circuits above. The browser-hardening set (nosniff,
// Referrer-Policy, Permissions-Policy, HSTS in production; CSP and frame
// headers deliberately omitted for iframe embedding) lives in
// `@selvajs/server/http` — see `applySecurityHeaders` there for the rationale.
// Cache-control stays here: it encodes THIS app's asset layout.
function applyResponseHeaders(response: Response, pathname: string, requestId: string): Response {
	applySecurityHeaders(response, {
		hsts: process.env.NODE_ENV === 'production'
	});

	// Echo the correlation id. A user reporting "request X failed" gives an
	// operator the exact key to grep the logs with — the reason this passes
	// through every response path, including the 401/503 short-circuits.
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
	// For expected HTTP errors (thrown with error(4xx, body)), pass the
	// structured body through unchanged so `code`/`fields` reach the client.
	// For unexpected errors, show a generic message to avoid leaking internals.
	if (isHttpError(error)) {
		const body = error.body as App.Error;
		return { message: body.message, code: body.code, fields: body.fields };
	}
	if (status === 404) {
		return { message: 'Page not found.', code: 'NOT_FOUND' };
	}
	// Log enough context to diagnose without grepping: route, method, and the
	// underlying cause chain. SvelteKit's default logging drops `cause`, which
	// is where provider adapters tend to stash the real reason (Supabase
	// network error, fs EACCES, etc.). `err`/`cause` stay separate fields rather
	// than being concatenated into the message, so the message groups cleanly
	// while the stack remains searchable.
	//
	// `locals.log` carries requestId/method/route already, but handleError can
	// fire before `handle` populated locals (e.g. a throw in an earlier hook), so
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
	// Ship off-box for triage. Only reached for genuinely unexpected errors:
	// intentional HTTP outcomes (incl. the compute route's `apiError(500)` on a
	// failed solve) are `HttpError`s handled in the branch above, so compute
	// failures are never reported here. No-op unless SENTRY_DSN is configured.
	getErrorReporter().capture(error, {
		method: event.request.method,
		route: event.url.pathname,
		userId: event.locals.ctx?.userId || undefined,
		orgId: event.locals.ctx?.actingOrgId
	});
	return { message: 'An unexpected error occurred.', code: 'INTERNAL' };
};
