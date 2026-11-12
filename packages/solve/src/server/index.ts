// ============================================================================
// server/ — the solve core behind the wire
// ============================================================================
//
// Given a resolved solve context (definition bytes, inputs + values, a warm scheduler), runs a
// solve and returns a ready-to-send envelope: build input tree → solve → serialize → gzip →
// Server-Timing, plus the caches that make a repeat solve cheap (single-flight coalescing,
// definition-byte cache, Rhino.Compute client cache).
//
// **Node-only** (`node:zlib`, `node:util`, `undici`). `client/` must never import from here —
// enforced by `no-restricted-imports` in `eslint.config.mjs`, and on the built artifact by having
// no root barrel join the two halves.
//
// Not here, on purpose: auth, tenancy, rate limiting, SSRF guards. Those are request policy and
// stay in `@selvajs/server` (`/compute`, `/http`) and in the app route.

export {
	SolveEngine,
	type SolveEngineOptions,
	type SolveEngineLimits,
	type SolveEngineSolveArgs,
	type SolveEngineDefinitionSource,
	type SolveEngineStats
} from './solve-engine.js';

export type { SolveEngineOutcome } from './solve-pipeline.js';
export { wantsKeepalive, respondWithKeepalive } from './keepalive.js';
export { solveInputsFromSchema, postedServerSourcedIds } from './transform-input.js';

export {
	acceptsGzip,
	COMPUTE_CONTRACT_VERSION,
	COMPUTE_VERSION_HEADER,
	type SolveEnvelope,
	type SolvePhaseMetrics
} from './response-encoding.js';

export type { SolveCacheStats, CachedClient, ResolvedServer } from './client-cache.js';
export {
	DEFAULT_SOLVE_DEADLINE_MS,
	MAX_SOLVE_DEADLINE_MS,
	type SolveLimits
} from './server-limits.js';
export type { ByteCacheRef, ByteCacheStats, ByteRefOutcome } from './definition-byte-cache.js';

export type { DefinitionRef, SolveDefinition } from '@selvajs/compute/core';

// Re-exported so a server-only consumer needs one import path, matching `client/`.
export type { SolveInput } from '../shared/solve-input.js';
