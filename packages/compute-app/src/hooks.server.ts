import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import { verifySession } from '$lib/server/admin-auth.server';

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

// GH_DEFINITIONS_PATH is only required for filesystem source
if (definitionSource === 'filesystem' && !env.GH_DEFINITIONS_PATH) {
	missing.push('GH_DEFINITIONS_PATH');
}

if (missing.length > 0) {
	console.error('\n❌ CRITICAL CONFIGURATION ERROR');
	console.error('The following required environment variables are missing:');
	missing.forEach((key) => console.error(`   - ${key}`));
	console.error('\nPlease check your .env file or container configuration.\n');

	// Hard exit to prevent undefined behavior
	process.exit(1);
}

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Guard all admin routes except the login page itself
	if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
		if (!verifySession(event.cookies)) {
			// API requests get 401; page requests get redirected to login
			if (pathname.startsWith('/admin/api/')) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			redirect(303, '/admin/login');
		}
	}

	return resolve(event);
};
