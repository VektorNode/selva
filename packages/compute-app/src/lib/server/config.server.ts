import { env } from '$env/dynamic/private';

export function getServerConfig() {
	const computeServerUrl = env.COMPUTE_SERVER_URL;
	const ghDefinitionsBaseUrl = env.GH_DEFINITIONS_BASE_URL;
	const ghDefinitionsPath = env.GH_DEFINITIONS_PATH;

	// Validate required environment variables
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

	if (!ghDefinitionsBaseUrl && !ghDefinitionsPath) {
		const message = [
			'❌ Neither GH_DEFINITIONS_BASE_URL nor GH_DEFINITIONS_PATH is set!',
			'',
			'You must configure where to load Grasshopper definitions from.',
			'Set GH_DEFINITIONS_PATH for local files (recommended for safety)',
			'OR set GH_DEFINITIONS_BASE_URL for remote URLs.',
			'',
			'Examples:',
			'  - GH_DEFINITIONS_PATH="./definitions"',
			'  - GH_DEFINITIONS_BASE_URL="https://storage.mycompany.com/defs"',
			'',
			'The app appends ?gh=filename to find the specific definition.',
			'',
			'See .env.example for more details.'
		].join('\n');
		throw new Error(message);
	}

	// Validate URL formats
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
		ghDefinitionsBaseUrl,
		ghDefinitionsPath,
		computeApiKey: env.COMPUTE_API_KEY
	};
}

/**
 * Check if a string is a valid HTTP URL
 */
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
