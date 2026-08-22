/**
 * Re-export shell. The shared write-path rules moved to
 * `@selvajs/server/compute`.
 *
 * The apiKey merge is why they are shared at all: `/api/admin/compute` and
 * `/api/v1/orgs/{orgId}/compute` both accept a server set, and if their copies
 * disagree a stored credential silently gets cleared or leaked with nothing
 * failing at build time.
 */

export {
	validateIncomingServers,
	resolveApiKey,
	storedKeysById,
	type IncomingServerBase
} from '@selvajs/server/compute';
