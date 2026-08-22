// HTTP request policy for the compute path — transport-agnostic, env-injected.
//
// Admission control (rate limiting), an SSRF guard on operator-supplied URLs, env-derived limits,
// and the remote-definition fetcher. This is the policy *around* a solve, which is a different job
// from running one.
//
// **The solve core is not here.** Pipeline, L2 result cache, single-flight, and the client /
// definition-byte caches live in `@selvajs/solve/server`. Do not re-export them through this
// barrel: `@selvajs/server` does not depend on `@selvajs/solve`, and a borrowed surface stops
// describing what this package does.

export {
	resolveComputeLimits,
	readPositiveInt,
	readNonNegativeInt,
	readBool,
	type ComputeLimits,
	type EnvRecord
} from './limits.js';

export {
	createComputeRateLimiter,
	DEFAULT_MAX_KEYS,
	type ComputeRateLimiter,
	type ComputeRateLimiterConfig,
	type RateLimitResult
} from './rate-limit.js';

export {
	createIdempotencyStore,
	DEFAULT_IDEMPOTENCY_MAX_KEYS,
	type IdempotencyStore,
	type IdempotencyStoreConfig,
	type IdempotencyOutcome
} from './idempotency.js';

export {
	isSafeRemoteDefinitionUrl,
	assertSafeRemoteDefinitionUrl,
	isLinkLocalUrl
} from './safe-url.js';

export {
	createRemoteDefinitionFetcher,
	readBodyWithCap,
	type RemoteDefinitionFetcher,
	type RemoteDefinitionConfig
} from './remote-definition.js';

export { resolveServerForOrg } from './resolve-server.js';
export { ComputeServerUnconfiguredError } from './errors.js';
export { evictChangedServers, type ServerConnection } from './evict-changed-servers.js';
export {
	validateIncomingServers,
	resolveApiKey,
	storedKeysById,
	type IncomingServerBase
} from './server-config-write.js';
export {
	idempotencyKey,
	toStoredResponse,
	fromStoredResponse,
	IDEMPOTENCY_REPLAYED_HEADER,
	type StoredResponse
} from './idempotency-http.js';
