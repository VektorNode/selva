import { ComputeError, ErrorCodes } from '../errors';
import { warnOnce } from '../utils/warnings';

import type { ComputeAuth, ComputeConfig } from '../types';

/** `serverUrl` as `validateServerUrl` returns it: no trailing slash. */
export function buildUrl(endpoint: string, serverUrl: string): string {
	return `${serverUrl}/${endpoint.replace(/^\/+/, '')}`;
}

function isLocalhost(serverUrl: string): boolean {
	// `hostname` (not `host`) strips the port; IPv6 hostnames keep their
	// brackets, so `http://[::1]:6500` yields `[::1]`.
	const hostname = new URL(serverUrl).hostname.toLowerCase();
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

const DEFAULT_API_KEY_HEADER = 'RhinoComputeKey';

/**
 * Caller headers plus credentials. Every request to the server builds its headers here,
 * so a liveness probe authenticates exactly like the solve it gates.
 */
export function buildAuthHeaders(auth: ComputeAuth): Record<string, string> {
	return assertSendable(mergeUnder(auth.headers, credentialHeaders(auth)));
}

export function buildHeaders(requestId: string, config: ComputeConfig): Record<string, string> {
	const headers = assertSendable(
		mergeUnder(config.headers, {
			...credentialHeaders(config),
			'X-Request-ID': requestId,
			'Content-Type': 'application/json'
		})
	);

	if (!config.apiKey && !config.authToken && !isLocalhost(config.serverUrl)) {
		warnOnce(
			`no-auth:${config.serverUrl}`,
			`[Compute] Request [${requestId}] targets remote server (${config.serverUrl}) but no API key or auth token is configured. Requests may fail or be rate-limited. (warned once per server)`
		);
	}

	return headers;
}

/** `headers` with a JSON `Content-Type` that replaces one of any casing already there. */
export function withJsonContentType(headers: Record<string, string>): Record<string, string> {
	return mergeUnder(headers, { 'Content-Type': 'application/json' });
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

/**
 * Left to fetch, a bad value becomes a retried TypeError that quotes it, and the value may be the
 * API key. `Headers` throws the same message, so its error is not kept as the cause.
 */
function assertSendable(headers: Record<string, string>): Record<string, string> {
	const check = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		try {
			check.set(name, value);
		} catch {
			throw new ComputeError(
				`Header "${name}" has an invalid name or value`,
				ErrorCodes.INVALID_CONFIG,
				{ context: { header: name } }
			);
		}
	}
	return headers;
}

export function generateRequestId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
