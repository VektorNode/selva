/**
 * Shared write-path rules for compute server config.
 *
 * Two routes accept a server set: `/api/admin/compute` (platform scope,
 * `manage_compute`) and `/api/v1/orgs/{orgId}/compute` (org scope,
 * `manage_org_compute`). They differ in who may call them, what extra fields
 * they carry (`sharedWith` vs `ownerOrgId`), and how they validate the default
 * selection — but the field validation and the apiKey merge below must behave
 * identically in both, so they live here rather than in either handler.
 *
 * The apiKey merge is why this file exists: if the two copies disagree, a
 * stored credential silently gets cleared or leaked, and nothing fails at
 * build time.
 */

import { env } from '$env/dynamic/private';
import { isSafeRemoteDefinitionUrl } from '@selvajs/server/compute';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';

/**
 * A stored `serverUrl` is fetched server-side on every status probe, every
 * purge/shutdown action, and every solve — so an unfiltered one is an SSRF
 * primitive handed to whoever holds `manage_compute`. Two rules:
 *
 *   - Scheme allowlist (`http`/`https`), always. `file:`, `gopher:` and friends
 *     are never a Rhino.Compute endpoint, so there is nothing to trade off.
 *   - Private/link-local block, on by default. This one IS a real tradeoff: a
 *     compute server on the same LAN or on loopback is an ordinary
 *     self-hosted deployment, not an attack. So it is opt-out via
 *     `COMPUTE_ALLOW_PRIVATE_SERVER_URL=true` — an operator who genuinely runs
 *     compute on `10.x` sets it once and knows what they turned off. Left on,
 *     it blocks the case that actually matters: `169.254.169.254` and other
 *     cloud metadata endpoints.
 *
 * The literal filter is reused rather than reimplemented — it already handles
 * the IP encodings (integer, octal, hex, IPv4-mapped IPv6) a hand-rolled check
 * misses. Only the synchronous half applies here: the DNS half of
 * `assertSafeRemoteDefinitionUrl` would make a config save fail on a name that
 * merely doesn't resolve yet, which is the wrong failure for an operator
 * typing in a server they are about to stand up.
 */
function assertUsableServerUrl(serverUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(serverUrl);
	} catch {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, `Invalid serverUrl: ${serverUrl}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, `serverUrl must use http or https: ${serverUrl}`);
	}
	if (env.COMPUTE_ALLOW_PRIVATE_SERVER_URL === 'true') return;
	if (!isSafeRemoteDefinitionUrl(serverUrl)) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`serverUrl points at a private, loopback, or link-local address: ${serverUrl}. ` +
				'Set COMPUTE_ALLOW_PRIVATE_SERVER_URL=true if your compute server really is on an internal network.'
		);
	}
}

/** The fields every incoming server carries, whatever its scope. */
export interface IncomingServerBase {
	id: string;
	label: string;
	serverUrl: string;
	/**
	 * `undefined` → preserve the stored key; `null` → clear it;
	 * non-empty string → replace it. See {@link resolveApiKey}.
	 */
	apiKey?: string | null;
	timeoutMs?: number;
	retryCount?: number;
}

/**
 * Validates the scope-independent fields of every submitted server. Throws the
 * first failure as a 400; scope-specific fields (`sharedWith`, `ownerOrgId`)
 * are the caller's business.
 */
export function validateIncomingServers(servers: readonly IncomingServerBase[]): void {
	for (const s of servers) {
		if (!s.id || typeof s.id !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Each server needs an id');
		if (!s.label || typeof s.label !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Each server needs a label');
		if (!s.serverUrl || typeof s.serverUrl !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Each server needs a serverUrl');
		assertUsableServerUrl(s.serverUrl);
		if (s.apiKey !== undefined && s.apiKey !== null && typeof s.apiKey !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'apiKey must be a string, null, or omitted');
	}
}

/**
 * The UI never receives stored keys — it sends back `hasApiKey` and omits the
 * field for servers the operator didn't touch. So "omitted" cannot mean "clear":
 * it has to preserve, or every save through the settings form would wipe the
 * keys of every server the operator left alone. Clearing is explicit (`null`);
 * an empty string is treated as "not provided" since that's what an untouched
 * password input submits.
 */
export function resolveApiKey(
	submitted: string | null | undefined,
	storedKey: string | undefined
): string | undefined {
	if (submitted === null) return undefined;
	return submitted ? submitted : storedKey;
}

/**
 * Builds the id → stored-key lookup the merge reads. The caller passes only the
 * servers in its own scope, so one scope's write can never resolve a key from
 * another's rows.
 */
export function storedKeysById(
	scopedServers: readonly { id: string; apiKey?: string }[]
): Map<string, string | undefined> {
	return new Map(scopedServers.map((s) => [s.id, s.apiKey]));
}
