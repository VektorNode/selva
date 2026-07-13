// Compute/solve server building blocks — transport-agnostic, env-injected.

export {
	resolveComputeLimits,
	readPositiveInt,
	readNonNegativeInt,
	readBool,
	type ComputeLimits,
	type EnvRecord
} from './limits.js';

export {
	createDefinitionByteCache,
	type DefinitionByteCache,
	type ByteCacheRef,
	type ByteCacheStats
} from './definition-byte-cache.js';

export {
	createComputeRateLimiter,
	type ComputeRateLimiter,
	type ComputeRateLimiterConfig,
	type RateLimitResult
} from './rate-limit.js';

export { isSafeRemoteDefinitionUrl, assertSafeRemoteDefinitionUrl } from './safe-url.js';

export { transformInputParameter } from './transform-input.js';

export {
	createClientCache,
	serverIdentity,
	type ClientCache,
	type ClientCacheConfig,
	type CachedClient,
	type ResolvedServer,
	type ServerIdentity
} from './client-cache.js';

export {
	createRemoteDefinitionFetcher,
	readBodyWithCap,
	type RemoteDefinitionFetcher,
	type RemoteDefinitionConfig
} from './remote-definition.js';

export {
	runSolvePipeline,
	COMPUTE_CONTRACT_VERSION,
	COMPUTE_VERSION_HEADER,
	type SolvePipelineArgs,
	type SolveOutcome,
	type SolveEnvelope,
	type SolvePhaseMetrics,
	type PipelineInput
} from './solve-pipeline.js';
