import { RhinoComputeError, ErrorCodes } from '@/core/errors';

/**
 * The public McNeel endpoint's host — disallowed as a `serverUrl`; users must point at
 * their own server. Compared against the parsed hostname lowercased and with any
 * trailing dot stripped, so the FQDN form (`compute.rhino3d.com.`) can't bypass it.
 * Known limitation: the endpoint's raw IP is not blocked — it sits behind a load
 * balancer with no single stable, verifiable address to pin.
 */
const DEFAULT_PUBLIC_HOST = 'compute.rhino3d.com';

/**
 * Validate and normalize a Rhino Compute `serverUrl`.
 *
 * This is the single source of truth for "is this a usable server URL?" — both
 * `GrasshopperClient` (via `normalizeComputeConfig`) and the standalone-exported
 * `ComputeServerStats` constructor delegate here, so a given URL is accepted or
 * rejected identically no matter which entry point a caller uses.
 *
 * Rules (all enforced, on the *trimmed* input — the trimmed form is what's
 * returned, so no stray whitespace survives into later `fetch` calls):
 * - non-empty (after trim)
 * - `http://` or `https://` scheme (case-insensitive, per RFC 3986)
 * - parseable by `new URL()`
 * - no embedded credentials (`http://user:pass@host`) — `fetch`/`new Request`
 *   reject credentialed URLs at runtime, so they must fail here instead
 * - no query string or fragment — endpoint paths are appended to this URL
 *   (`${serverUrl}/version`), which a `?…` or `#…` suffix would corrupt
 * - not the public McNeel endpoint — compared by parsed hostname (lowercased,
 *   trailing dot stripped), so scheme, casing, port, path, trailing-slash, or
 *   FQDN-dot variants can't slip past the block
 *
 * @param raw - The candidate server URL.
 * @returns The trimmed, normalized URL with any trailing slashes removed.
 * @throws {RhinoComputeError} `INVALID_CONFIG` if any rule fails.
 */
export function validateServerUrl(raw: string): string {
	const trimmed = raw?.trim() ?? '';
	if (!trimmed) {
		throw new RhinoComputeError('serverUrl is required', ErrorCodes.INVALID_CONFIG, {
			context: { receivedServerUrl: raw }
		});
	}

	if (!/^https?:\/\//i.test(trimmed)) {
		throw new RhinoComputeError(
			`Invalid serverUrl: "${trimmed}". Must start with "http://" or "https://". ` +
				`For example: "http://localhost:5000" or "https://example.com"`,
			ErrorCodes.INVALID_CONFIG,
			{ context: { receivedServerUrl: raw } }
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch (err) {
		throw new RhinoComputeError(
			`Invalid serverUrl: "${trimmed}". Must be a valid URL. ` +
				`Received error: ${err instanceof Error ? err.message : String(err)}`,
			ErrorCodes.INVALID_CONFIG,
			{
				context: { receivedServerUrl: raw },
				originalError: err instanceof Error ? err : undefined
			}
		);
	}

	if (parsed.username !== '' || parsed.password !== '') {
		throw new RhinoComputeError(
			`Invalid serverUrl: "${trimmed}". Must not embed credentials (user:pass@host) — ` +
				`fetch rejects credentialed URLs at request time. Pass the API key separately.`,
			ErrorCodes.INVALID_CONFIG,
			{ context: { receivedServerUrl: raw } }
		);
	}

	// String check rather than parsed.search/hash: a bare trailing "?" or "#"
	// parses to an empty search/hash but still corrupts endpoint concatenation.
	if (trimmed.includes('?') || trimmed.includes('#')) {
		throw new RhinoComputeError(
			`Invalid serverUrl: "${trimmed}". Must not contain a query string or fragment — ` +
				`endpoint paths are appended to this URL (e.g. "\${serverUrl}/version"), ` +
				`and a "?" or "#" suffix would corrupt every request path.`,
			ErrorCodes.INVALID_CONFIG,
			{ context: { receivedServerUrl: raw } }
		);
	}

	// Lowercase + strip any trailing dot so the FQDN form can't bypass the block.
	const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
	if (hostname === DEFAULT_PUBLIC_HOST) {
		throw new RhinoComputeError(
			'serverUrl must be set to your Compute server URL. The default public endpoint is not allowed.',
			ErrorCodes.INVALID_CONFIG,
			{ context: { receivedServerUrl: raw } }
		);
	}

	return trimmed.replace(/\/+$/, '');
}
