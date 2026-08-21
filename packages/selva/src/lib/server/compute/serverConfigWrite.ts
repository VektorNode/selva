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

import { isLinkLocalUrl } from '@selvajs/server/compute';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';

/**
 * A stored `serverUrl` is fetched server-side on every status probe, every
 * purge/shutdown action, and every solve, so an unfiltered one is an SSRF
 * primitive handed to whoever holds `manage_compute`. Two rules:
 *
 *   - Scheme allowlist: `http`/`https`. `file:`, `gopher:` and friends are never
 *     a Rhino.Compute endpoint.
 *   - Link-local (`169.254.0.0/16`) is refused. That range carries the cloud
 *     metadata service at `169.254.169.254`, which hands out the host's own IAM
 *     credentials to anything running on the box.
 *
 * **Loopback and RFC1918 are deliberately allowed.** Running compute on
 * `localhost:6500` or a LAN box is the ordinary self-hosted layout, not an
 * attack — most deployments reach their compute server over exactly those
 * addresses. Blocking them by default would break those instances on upgrade
 * and push every operator toward an opt-out flag, and a guard that everyone
 * disables protects nobody. So the check is narrowed to the range where no
 * legitimate compute server ever lives.
 *
 * What this does not stop: a privileged admin pointing the app at an internal
 * host to probe it. That is a real but much weaker concern than credential
 * theft, it needs `manage_compute` already, and it is inseparable from the
 * legitimate case. Revisit if `manage_org_compute` is ever delegated widely on
 * a multi-tenant instance.
 *
 * `isLinkLocalUrl` is reused rather than hand-rolled because a string compare
 * against `169.254.169.254` misses the encodings that reach the same address:
 * `http://2852039166/`, `http://0xa9fea9fe/`, `http://0251.0376.0251.0376/`.
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
	if (isLinkLocalUrl(serverUrl)) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`serverUrl points at the link-local range, which carries the cloud metadata service: ${serverUrl}`
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
