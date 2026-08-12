// ============================================================================
// server/ — the solve core behind the wire
// ============================================================================
//
// Given a resolved solve context (definition bytes, inputs + values, a warm scheduler), runs a
// solve and returns a ready-to-send envelope: build input tree → solve → serialize → gzip →
// Server-Timing, plus the caches that make a repeat solve cheap (single-flight coalescing,
// definition-byte cache, Rhino.Compute client cache).
//
// **Node-only** (`node:zlib`, `node:crypto`, `process.env`, platform-provider cache backends).
// `client/` must never import from here — enforced by `no-restricted-imports` in
// `eslint.config.mjs`, and on the built artifact by having no root barrel join the two halves.
//
// Not here, on purpose: HTTP status mapping, auth, tenancy, rate limiting, SSRF guards. Those are
// request policy and stay in `@selvajs/server` (`/compute`, `/http`) and in the app route.

// ============================================================================
// Pipeline
// ============================================================================

export {
	runSolvePipeline,
	buildSolveInputTree,
	adaptEnvelopeToEncoding,
	COMPUTE_CONTRACT_VERSION,
	COMPUTE_VERSION_HEADER,
	type SolvePipelineArgs,
	type SolveOutcome,
	type SolveEnvelope,
	type SolvePhaseMetrics,
	type PipelineInput
} from './solve-pipeline.js';

export { transformInputParameter } from './transform-input.js';

// ============================================================================
// Caches
// ============================================================================

export {
	createClientCache,
	serverIdentity,
	type ClientCache,
	type ClientCacheConfig,
	type SolveCacheStats,
	type CachedClient,
	type ResolvedServer,
	type ServerIdentity
} from './client-cache.js';

export {
	createDefinitionByteCache,
	type DefinitionByteCache,
	type ByteCacheRef,
	type ByteCacheStats,
	type ByteRefOutcome
} from './definition-byte-cache.js';

export {
	createSolveCacheSingleFlight,
	type SolveCacheSingleFlight,
	type SolveCacheSingleFlightOptions
} from './solve-cache-single-flight.js';

// ============================================================================
// Facade
// ============================================================================

export {
	SolveEngine,
	type SolveEngineOptions,
	type SolveEngineLimits,
	type SolveEngineSolveArgs,
	type SolveEngineDefinitionSource,
	type SolveEngineStats,
	type FrameworkAgnosticResponse
} from './solve-engine.js';

export type { DefinitionRef, SolveDefinition } from '@selvajs/compute/core';
export { isDefinitionRef } from '@selvajs/compute/core';

// ============================================================================
// Shared vocabulary
// ============================================================================
//
// Re-exported so a server-only consumer needs one import path, matching `client/`.

export type { SolveInput } from '../shared/solve-input.js';
