import { getLogger } from '../utils/logger';

import type { ComputeAuth, ComputeConfig } from '../types';

/** `serverUrl` as `validateServerUrl` returns it: no trailing slash. */
export function buildUrl(endpoint: string, serverUrl: string): string {
	return `${serverUrl}/${endpoint.replace(/^\/+/, '')}`;
}

function isLocalhost(serverUrl: string): boolean {
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

const DEFAULT_API_KEY_HEADER = 'RhinoComputeKey';

/**
 * Caller headers plus credentials. Every request to the server builds its headers here,
 * so a liveness probe authenticates exactly like the solve it gates.
 */
export function buildAuthHeaders(auth: ComputeAuth): Record<string, string> {
	return mergeUnder(auth.headers, credentialHeaders(auth));
}

export function buildHeaders(requestId: string, config: ComputeConfig): HeadersInit {
	const headers = mergeUnder(config.headers, {
		...credentialHeaders(config),
		'X-Request-ID': requestId,
		'Content-Type': 'application/json'
	});

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

function credentialHeaders(auth: ComputeAuth): Record<string, string> {
	return {
		...(auth.authToken && { Authorization: auth.authToken }),
		...(auth.apiKey && { [auth.apiKeyHeader ?? DEFAULT_API_KEY_HEADER]: auth.apiKey })
	};
}

/**
 * Header names are case-insensitive and fetch joins duplicates, so a caller key
 * matching a transport key in any case is dropped rather than sent alongside it.
 */
function mergeUnder(
	caller: Record<string, string> | undefined,
	transport: Record<string, string>
): Record<string, string> {
	const taken = new Set(Object.keys(transport).map((name) => name.toLowerCase()));
	const kept = Object.entries(caller ?? {}).filter(([name]) => !taken.has(name.toLowerCase()));
	return { ...Object.fromEntries(kept), ...transport };
}

export function generateRequestId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
