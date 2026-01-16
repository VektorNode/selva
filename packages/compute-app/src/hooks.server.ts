import { env } from '$env/dynamic/private';

/**
 * Validate Critical Environment Variables on Startup
 *
 * We check this at runtime (not build time) to allow for
 * "Build Once, Run Anywhere" Docker images.
 */
const REQUIRED_KEYS = ['COMPUTE_SERVER_URL', 'GH_DEFINITIONS_PATH'];
const missing = REQUIRED_KEYS.filter((key) => !env[key]);

if (missing.length > 0) {
	console.error('\n❌ CRITICAL CONFIGURATION ERROR');
	console.error('The following required environment variables are missing:');
	missing.forEach((key) => console.error(`   - ${key}`));
	console.error('\nPlease check your .env file or container configuration.\n');

	// Hard exit to prevent undefined behavior
	process.exit(1);
}

export const handle = async ({ event, resolve }) => {
	return resolve(event);
};
