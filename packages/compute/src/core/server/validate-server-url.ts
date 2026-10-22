import { ComputeError, ErrorCodes } from '@/core/errors';

/**
 * The public McNeel endpoint, blocked by default: users must point at their own server. Its raw IP
 * isn't blocked: it sits behind a load balancer with no stable address to pin.
 */
export const DEFAULT_BLOCKED_HOST = 'compute.rhino3d.com';

export interface ValidateServerUrlOptions {
	/**
	 * Hostnames rejected as a `serverUrl` — a backend's shared public endpoint,
	 * which callers must not point at. Defaults to `[DEFAULT_BLOCKED_HOST]`; pass
	 * `[]` to block nothing. Compared lowercased with any trailing dot stripped.
	 */
	blockedHosts?: readonly string[];
}

/**
 * Validate a compute `serverUrl` and return it trimmed, without trailing slashes. Every entry point
 * that takes a server URL calls this, so a URL is accepted or rejected the same way everywhere.
 *
 * @throws {ComputeError} `INVALID_CONFIG` when the URL is empty, isn't http(s), doesn't parse,
 *   embeds credentials, has a query or fragment, or names a blocked host.
 */
export function validateServerUrl(raw: string, options?: ValidateServerUrlOptions): string {
	const trimmed = raw?.trim() ?? '';
	if (!trimmed) {
		throw new ComputeError('serverUrl is required', ErrorCodes.INVALID_CONFIG, {
			context: { receivedServerUrl: raw }
		});
	}

	const invalid = (reason: string, originalError?: unknown) =>
		new ComputeError(`Invalid serverUrl: "${trimmed}". ${reason}`, ErrorCodes.INVALID_CONFIG, {
			context: { receivedServerUrl: raw },
			originalError
		});

	if (!/^https?:\/\//i.test(trimmed)) {
		throw invalid(
			'Must start with "http://" or "https://". ' +
				'For example: "http://localhost:6500" or "https://example.com"'
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch (err) {
		throw invalid(
			`Must be a valid URL. Received error: ${err instanceof Error ? err.message : String(err)}`,
			err
		);
	}

	if (parsed.username !== '' || parsed.password !== '') {
		throw invalid(
			'Must not embed credentials (user:pass@host) — ' +
				'fetch rejects credentialed URLs at request time. Pass the API key separately.'
		);
	}

	// A string check: a bare trailing "?" or "#" parses to an empty search/hash but still corrupts
	// the endpoint paths appended to this URL.
	if (trimmed.includes('?') || trimmed.includes('#')) {
		throw invalid(
			'Must not contain a query string or fragment — ' +
				'endpoint paths are appended to this URL (e.g. "${serverUrl}/version"), ' +
				'and a "?" or "#" suffix would corrupt every request path.'
		);
	}

	// Lowercase + strip any trailing dot so the FQDN form can't bypass the block.
	const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
	const blocked = (options?.blockedHosts ?? [DEFAULT_BLOCKED_HOST]).map((h) =>
		h.toLowerCase().replace(/\.+$/, '')
	);
	if (blocked.includes(hostname)) {
		throw new ComputeError(
			'serverUrl must be set to your Compute server URL. The shared public endpoint is not allowed.',
			ErrorCodes.INVALID_CONFIG,
			{ context: { receivedServerUrl: raw } }
		);
	}

	return trimmed.replace(/\/+$/, '');
}
