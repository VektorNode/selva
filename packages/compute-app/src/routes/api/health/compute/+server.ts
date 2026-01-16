import { json, type RequestHandler } from '@sveltejs/kit';
import { getServerConfig } from '$lib/server/config.server';

/**
 * Compute server health check endpoint
 * Validates connectivity and configuration of the Rhino Compute server
 */
export const GET: RequestHandler = async () => {
	const config = getServerConfig();
	const isProduction = !config.computeServerUrl.includes('localhost');

	const response = {
		status: 'unknown' as 'ok' | 'error' | 'warning' | 'unknown',
		timestamp: new Date().toISOString(),
		computeServer: {
			url: config.computeServerUrl,
			isLocal: !isProduction,
			reachable: false
		},
		definitions: {
			source: 'unknown' as 'local' | 'remote',
			configured: false
		},
		warnings: [] as string[]
	};

	// Check compute server connectivity
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

		const healthUrl = new URL('/version', config.computeServerUrl).toString();
		const headers: Record<string, string> = {};

		// Rhino Compute uses 'RhinoComputeKey' header for API key
		if (config.computeApiKey) {
			headers['RhinoComputeKey'] = config.computeApiKey;
		}

		const resp = await fetch(healthUrl, {
			signal: controller.signal,
			headers
		});

		clearTimeout(timeout);

		if (resp.ok) {
			response.computeServer.reachable = true;
			response.status = 'ok';
		} else {
			response.computeServer.reachable = false;
			response.warnings.push(`Compute server returned status ${resp.status}`);
			response.status = 'warning';
		}
	} catch (error) {
		response.warnings.push(
			error instanceof Error
				? `Failed to reach compute server: ${error.message}`
				: 'Failed to reach compute server'
		);
		response.status = 'error';
	}

	// Check definition source configuration
	if (config.ghDefinitionsPath) {
		response.definitions.source = 'local';
		response.definitions.configured = true;

		// Warn if using local definitions with production compute server
		if (isProduction) {
			response.warnings.push(
				'Using local definitions with production compute server. ' +
					'The server cannot access local files. Use the environment loader with GH_DEF_* variables instead.'
			);
			response.status = 'warning';
		}
	}

	// Check API key for production
	if (isProduction && !config.computeApiKey) {
		response.warnings.push('Using production compute server without API key');
		response.status = 'warning';
	}

	return json(response, {
		status: response.status === 'error' ? 503 : 200
	});
};
