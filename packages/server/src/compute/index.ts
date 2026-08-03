// HTTP request policy for the compute path — transport-agnostic, env-injected.
//
// Admission control (rate limiting), an SSRF guard on operator-supplied URLs, env-derived limits,
// and the remote-definition fetcher. This is the policy *around* a solve, which is a different job
// from running one.
//
// **The solve core is not here.** Pipeline, L2 result cache, single-flight, and the client /
// definition-byte caches live in `@selvajs/solve/server`, which owns the solve flow on both sides of
// the wire. This sub-path deliberately does NOT re-export them: a compat shim was built during the
// extraction and removed before release, because it left this barrel at 24 exports of which 14 were
// borrowed — a surface that no longer described what the package does. `@selvajs/server` does not
// depend on `@selvajs/solve`.

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

export { isSafeRemoteDefinitionUrl, assertSafeRemoteDefinitionUrl } from './safe-url.js';

export {
	createRemoteDefinitionFetcher,
	readBodyWithCap,
	type RemoteDefinitionFetcher,
	type RemoteDefinitionConfig
} from './remote-definition.js';
