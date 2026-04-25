import { redirect } from '@sveltejs/kit';
import { isHttpError } from '@sveltejs/kit';
import type { AuthUser, RequestContext } from '@selva/platform';
import { SYSTEM_CONTEXT, emptyProfile } from '@selva/platform';
import { providers } from '$lib/server/providers.server';

// Env validation is owned by each provider's `fromEnv()` — the selected
// provider throws on missing vars (e.g. DATA_PATH for local, SUPABASE_URL for
// supabase) while `providers.server.ts` is loaded. No compute-app-level check
// is needed here.

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

	// SYSTEM_CONTEXT is fine here — we then look up the *user's* membership
	// explicitly. For multi-tenant the membership lookup is what scopes; for
	// single-tenant there's only one org anyway.
	const orgsPage = await providers.data.orgs.listOrgs(SYSTEM_CONTEXT, { limit: 50 });

	for (const org of orgsPage.items) {
		const member = await providers.data.orgs.getOrgMember(SYSTEM_CONTEXT, org.id, user.id);
		if (member) {
			actingOrgId = org.id;
			orgPermissions = member.permissions;
			break;
		}
	}

	if (!actingOrgId && user.platformPermissions.includes('instance_admin')) {
		// Instance admins without an explicit membership row fall back to the
		// first org so admin tooling stays usable before a switcher exists.
		const firstOrg = orgsPage.items[0];
		if (firstOrg) actingOrgId = firstOrg.id;
	}

	// Composition seam — `platformPermissions` come from the auth provider today
	// (baked into `AuthUser`). Future Eterna refactor will source them from a
	// data-layer permission store instead so external IdPs don't need to own
	// Selva-specific authorization. When that lands, this is the one line that
	// changes here; writes funnel through `lib/server/permissions.server.ts`.
	return {
		userId: user.id,
		actingOrgId,
		platformPermissions: user.platformPermissions,
		orgPermissions,
		adapterContext: sessionToken ? { sessionToken } : undefined
	};
}

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
	event.locals.providers = providers;

	const { pathname } = event.url;

	const isPublicRoute =
		pathname === '/login' ||
		pathname === '/setup' ||
		pathname === '/accept-invite' ||
		pathname.startsWith('/logout');

	const isAdminRoute = pathname.startsWith('/admin');
	const isApiRoute = pathname.startsWith('/api/');
	const isDefinitionsRoute = pathname.startsWith('/definitions');
	const isAppRoute = pathname.startsWith('/app');

	const isJsonApiRoute = isApiRoute || pathname.startsWith('/admin/api/');

	// On first run (no users yet), redirect all admin traffic to /setup
	if (isAdminRoute || isApiRoute) {
		const usersPage = await providers.auth.listUsers({ limit: 1 });
		if (usersPage !== null && usersPage.items.length === 0) {
			if (isJsonApiRoute) {
				return new Response(JSON.stringify({ error: 'Setup required' }), {
					status: 503,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			redirect(303, '/setup');
		}
	}

	// Guard admin, api, definitions, and /app routes
	const needsAuth =
		(isAdminRoute || isApiRoute || isDefinitionsRoute || isAppRoute) && !isPublicRoute;
	if (needsAuth) {
		const token = event.cookies.get('admin_session') ?? '';
		const user = await providers.auth.verifyToken(token);

		if (!user) {
			if (isJsonApiRoute) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			redirect(303, `/login?redirectTo=${encodeURIComponent(pathname)}`);
		}

		// Make the authenticated user + profile + request context available to route loaders.
		// The profile lookup is one extra read per authed request; local reads `users.json`
		// already cached by the auth flow, Supabase will hit the user_profiles table.
		// Use SYSTEM_CONTEXT for the profile load — ctx itself isn't built yet,
		// and the user is loading their own profile during request bootstrap.
		event.locals.user = user;
		event.locals.profile =
			(await providers.userProfile.getProfile(SYSTEM_CONTEXT, user.id)) ??
			emptyProfile(user.id);
		event.locals.ctx = await buildContext(user, token);
	}

	const response = await resolve(event);

	// Hashed build assets (immutable — filename changes on content change)
	if (pathname.startsWith('/_app/')) {
		response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	}

	// Static assets (favicon, robots.txt, etc.)
	if (
		pathname.startsWith('/favicon/') ||
		pathname === '/favicon.svg' ||
		pathname === '/robots.txt'
	) {
		response.headers.set('Cache-Control', 'public, max-age=604800');
	}

	return response;
};

export const handleError: import('@sveltejs/kit').HandleServerError = ({ error, status }) => {
	// For expected HTTP errors (thrown with error(4xx, message)), pass the message through as-is.
	// For unexpected errors, show a generic message to avoid leaking internals.
	if (isHttpError(error)) {
		return { message: error.body.message };
	}
	if (status === 404) {
		return { message: 'Page not found.' };
	}
	console.error('[Unhandled error]', error);
	return { message: 'An unexpected error occurred.' };
};
