import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import { isHttpError } from '@sveltejs/kit';
import type { AuthUser, RequestContext } from '@selva/platform';
import { SYSTEM_CONTEXT, emptyProfile } from '@selva/platform';
import { providers } from '$lib/server/providers.server';

/**
 * Validate Critical Environment Variables on Startup
 *
 * We check this at runtime (not build time) to allow for
 * "Build Once, Run Anywhere" Docker images.
 */
const definitionSource = env.DEFINITION_SOURCE || 'filesystem';
const missing = [];

// COMPUTE_SERVER_URL is always required
if (!env.COMPUTE_SERVER_URL) {
	missing.push('COMPUTE_SERVER_URL');
}

// DATA_PATH is only required for filesystem source
if (definitionSource === 'filesystem' && !env.DATA_PATH) {
	missing.push('DATA_PATH');
}

if (missing.length > 0) {
	console.error('\n❌ CRITICAL CONFIGURATION ERROR');
	console.error('The following required environment variables are missing:');
	missing.forEach((key) => console.error(`   - ${key}`));
	console.error('\nPlease check your .env file or container configuration.\n');

	// Hard exit to prevent undefined behavior
	process.exit(1);
}

/**
 * Build a per-request context from an authenticated user.
 *
 * §1g-core: resolves the user's active org membership and loads its
 * `OrgPermission[]` into the context so store methods and routes see the
 * fine-grained org-scope permissions. Single-org local mode means "active
 * org" is just the one org the user belongs to. §1g-ui will generalize this
 * to resolve from `/o/{slug}/` path prefix for multi-tenant deployments.
 *
 * `sessionToken` is forwarded as `adapterContext` so adapters that need the
 * upstream auth token (e.g. Supabase RLS) can pull it off the context.
 */
async function buildContext(
	user: AuthUser,
	sessionToken: string | undefined
): Promise<RequestContext> {
	// Pick the first org the user belongs to. Local provider is single-org,
	// so this is deterministic. Platform admins without an explicit org
	// membership get an empty `orgPermissions` — `hasPermission(ctx, ...)`
	// still returns true for them because of the platform_admin short-circuit.
	let orgId: string | undefined;
	let orgPermissions: RequestContext['orgPermissions'] = [];

	const orgsPage = await providers.data.orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 });
	const firstOrg = orgsPage.items[0];
	if (firstOrg) {
		const member = await providers.data.orgs.getOrgMember(
			SYSTEM_CONTEXT,
			firstOrg.id,
			user.id
		);
		if (member) {
			orgId = firstOrg.id;
			orgPermissions = member.permissions;
		} else if (user.platformPermissions.includes('platform_admin')) {
			// Platform admins act against the first org even without an explicit
			// membership row — keeps the UI usable pre-§1g-ui.
			orgId = firstOrg.id;
		}
	}

	return {
		userId: user.id,
		orgId,
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
		event.locals.user = user;
		event.locals.profile =
			(await providers.userProfile.getProfile(user.id)) ?? emptyProfile(user.id);
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
