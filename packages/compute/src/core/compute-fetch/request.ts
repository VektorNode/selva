import { getLogger } from '../utils/logger';

import type { ComputeAuth, ComputeConfig } from '../types';

export function buildUrl(endpoint: string, serverUrl: string): string {
	const base = serverUrl.replace(/\/+$/, '');
	const path = endpoint.replace(/^\/+/, '');
	return `${base}/${path}`;
}

export function isLocalhost(serverUrl: string): boolean {
	try {
		// `hostname` (not `host`) strips the port; IPv6 hostnames keep their
		// brackets, so `http://[::1]:6500` yields `[::1]`.
		const hostname = new URL(serverUrl).hostname.toLowerCase();
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
	} catch {
		return /(localhost|127\.0\.0\.1|\[::1\])/i.test(serverUrl);
	}
}

/** Server URLs already warned about missing auth — warn once per server, not per request. */
const warnedNoAuth = new Set<string>();

/** Header name rhino.compute reads the API key from. Override via `ComputeConfig.apiKeyHeader`. */
export const DEFAULT_API_KEY_HEADER = 'RhinoComputeKey';

/**
 * Caller headers plus credentials. Every request to the server builds its headers here,
 * so a liveness probe authenticates exactly like the solve it gates.
 */
export function buildAuthHeaders(auth: ComputeAuth): Record<string, string> {
	return {
		// Caller headers first so the credentials below OVERWRITE them.
		...auth.headers,
		...(auth.authToken && { Authorization: auth.authToken }),
		...(auth.apiKey && { [auth.apiKeyHeader ?? DEFAULT_API_KEY_HEADER]: auth.apiKey })
	};
}

export function buildHeaders(requestId: string, config: ComputeConfig): HeadersInit {
	const headers: HeadersInit = {
		...buildAuthHeaders(config),
		'X-Request-ID': requestId,
		'Content-Type': 'application/json'
	};

	if (
		!config.apiKey &&
		!config.authToken &&
		!warnedNoAuth.has(config.serverUrl) &&
		!isLocalhost(config.serverUrl)
	) {
		warnedNoAuth.add(config.serverUrl);
		getLogger().warn(
			`⚠️ [Compute] Request [${requestId}] targets remote server (${config.serverUrl}) but no API key or auth token is configured. Requests may fail or be rate-limited. (warned once per server)`
		);
	}

	return headers;
}

export function generateRequestId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
