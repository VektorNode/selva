import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import { isHttpError } from '@sveltejs/kit';
import type { AuthUser, RequestContext } from '@selva/platform';
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
 * Multi-tenant deployments will extend this to resolve the active org
 * (from subdomain, header, or user's default).
 */
function buildContext(user: AuthUser): RequestContext {
	return {
		userId: user.id,
		permissions: user.permissions
	};
}

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
	event.locals.providers = providers;

	const { pathname } = event.url;

	const isPublicRoute =
		pathname === '/login' ||
		pathname === '/setup' ||
		pathname.startsWith('/logout');

	const isAdminRoute = pathname.startsWith('/admin');

	// On first run (no users yet), redirect all admin traffic to /setup
	if (isAdminRoute) {
		const usersPage = await providers.auth.listUsers({ limit: 1 });
		if (usersPage !== null && usersPage.items.length === 0) {
			if (pathname.startsWith('/admin/api/')) {
				return new Response(JSON.stringify({ error: 'Setup required' }), {
					status: 503,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			redirect(303, '/setup');
		}
	}

	// Guard admin routes and /app (login/setup/logout are public)
	const needsAuth = (isAdminRoute || pathname.startsWith('/app')) && !isPublicRoute;
	if (needsAuth) {
		const token = event.cookies.get('admin_session') ?? '';
		const user = await providers.auth.verifyToken(token);

		if (!user) {
			// API requests get 401; page requests get redirected to login
			if (pathname.startsWith('/admin/api/')) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			// For /app, let the route handle auth (it throws proper 401)
			if (pathname.startsWith('/app')) {
				event.locals.user = undefined;
				const response = await resolve(event);
				return response;
			}
			redirect(303, '/login');
		}

		// Make the authenticated user + request context available to route loaders
		event.locals.user = user;
		event.locals.ctx = buildContext(user);
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
