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
 * The apiKey merge is the reason this file exists: a divergence between the two
 * copies silently clears or leaks a stored credential, and nothing fails at
 * build time.
 */

import { apiError, ApiErrorCode } from '$lib/server/api-errors';

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
 * Validate the scope-independent fields of every submitted server. Throws the
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
		try {
			new URL(s.serverUrl);
		} catch {
			apiError(400, ApiErrorCode.VALIDATION_FAILED, `Invalid serverUrl: ${s.serverUrl}`);
		}
		if (s.apiKey !== undefined && s.apiKey !== null && typeof s.apiKey !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'apiKey must be a string, null, or omitted');
	}
}

/**
 * Resolve the key to persist for one server.
 *
 * The UI never receives stored keys — it sends back `hasApiKey` and omits the
 * field for servers the operator didn't touch. So "omitted" cannot mean "clear":
 * it has to preserve, or every save through the settings form would wipe the
 * keys of every server the operator left alone. Clearing is therefore explicit
 * (`null`), and an empty string is treated as "not provided" because that is
 * what an untouched password input submits.
 *
 * @param submitted the `apiKey` field as it arrived
 * @param storedKey the key currently persisted for this server id, if any
 */
export function resolveApiKey(
	submitted: string | null | undefined,
	storedKey: string | undefined
): string | undefined {
	if (submitted === null) return undefined;
	return submitted ? submitted : storedKey;
}

/**
 * Build the id → stored-key lookup the merge reads. The caller passes only the
 * servers in its own scope, so one scope's write can never resolve a key from
 * another's rows.
 */
export function storedKeysById(
	scopedServers: readonly { id: string; apiKey?: string }[]
): Map<string, string | undefined> {
	return new Map(scopedServers.map((s) => [s.id, s.apiKey]));
}
