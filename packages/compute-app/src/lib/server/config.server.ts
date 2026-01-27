import { env } from '$env/dynamic/private';

/**
 * Load and validate server configuration from environment variables
 *
 * Required variables:
 * - COMPUTE_SERVER_URL: URL of the Rhino.Compute server
 * - GH_DEFINITIONS_PATH: Local directory containing definitions
 *
 * Optional:
 * - COMPUTE_API_KEY: API key for Rhino.Compute (if required by server)
 *
 * For remote definitions, use the environment loader:
 * - Set DEFINITION_SOURCE="environment"
 * - Define GH_DEF_* environment variables with definition URLs
 *
 * @throws {Error} If required variables are missing or invalid
 * @returns Server configuration object
 */
export function getServerConfig() {
	const computeServerUrl = env.COMPUTE_SERVER_URL;
	const ghDefinitionsPath = env.GH_DEFINITIONS_PATH;
	const definitionSource = env.DEFINITION_SOURCE || 'filesystem';

	// Validate: COMPUTE_SERVER_URL is required
	if (!computeServerUrl) {
		const message = [
			'❌ COMPUTE_SERVER_URL environment variable is missing!',
			'',
			'This is the URL of your Rhino.Compute server.',
			'',
			'Examples:',
			'  - Local Docker: http://host.docker.internal:8081',
			'  - Cloud: https://compute.mycompany.com',
			'  - Public: https://compute.rhino3d.com',
			'',
			'See .env.example for more details.'
		].join('\n');
		throw new Error(message);
	}

	// Validate: GH_DEFINITIONS_PATH is only required for filesystem source
	if (definitionSource === 'filesystem' && !ghDefinitionsPath) {
		const message = [
			'❌ GH_DEFINITIONS_PATH is not set!',
			'',
			'You must configure where to load Grasshopper definitions from.',
			'Set GH_DEFINITIONS_PATH to point to a local directory containing definitions.',
			'',
			'Examples:',
			'  - GH_DEFINITIONS_PATH="./definitions"',
			'  - GH_DEFINITIONS_PATH="/opt/grasshopper-defs"',
			'',
			'For remote definitions via environment variables, use the environment loader:',
			'  - Set DEFINITION_SOURCE="environment"',
			'  - Set GH_DEF_PREFIX="GH_DEF_" (optional, defaults to this)',
			'  - Define definitions as GH_DEF_MYDEF="https://storage.mycompany.com/mydef.gh"',
			'',
			'See .env.example for more details.'
		].join('\n');
		throw new Error(message);
	}

	// Validate: If COMPUTE_SERVER_URL is HTTP/HTTPS, check the protocol
	if (isValidUrl(computeServerUrl)) {
		const parsed = new URL(computeServerUrl);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			throw new Error(
				`❌ COMPUTE_SERVER_URL has invalid protocol: ${parsed.protocol}\n` +
					'Only http:// and https:// are supported.'
			);
		}
	}

	return {
		computeServerUrl,
		ghDefinitionsPath,
		computeApiKey: env.COMPUTE_API_KEY
	};
}

function isValidUrl(url: string): boolean {
	try {
		// Only validate if it looks like a URL (starts with http)
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			return false; // Could be a local path like /definitions
		}
		new URL(url);
		return true;
	} catch {
		return false;
	}
}
