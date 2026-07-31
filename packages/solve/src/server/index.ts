// ============================================================================
// server/ — the solve core behind the wire
// ============================================================================
//
// Given a resolved solve context (definition bytes, inputs + values, a warm scheduler), this half
// runs a solve and hands back a ready-to-send envelope: input tree build → solve → serialize →
// gzip → Server-Timing, plus the caches that make a repeat solve cheap (single-flight coalescing,
// definition-byte cache, Rhino.Compute client cache).
//
// **Node-only** (`node:zlib`, `node:crypto`, `process.env`, platform-provider cache backends).
// `client/` must never import from here — enforced by `no-restricted-imports` in
// `eslint.config.mjs` and, on the built artifact, by the absence of a root barrel joining the two
// halves; a browser bundle must not be able to reach this code at all.
//
// What is NOT here, on purpose: HTTP status mapping, auth, tenancy, rate limiting and SSRF guards.
// Those are request policy and stay in `@selvajs/server` (`/compute`, `/http`) and in the app route.

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
// Shared vocabulary
// ============================================================================
//
// Re-exported so a server-only consumer needs one import path, matching `client/`.

export type { SolveInput } from '../shared/solve-input.js';
