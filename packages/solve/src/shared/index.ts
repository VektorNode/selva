// ============================================================================
// shared/ — the vocabulary both halves speak
// ============================================================================
//
// Depends on nothing else in this package; `client/` and `server/` both depend on it, never on
// each other.

export type {
	SolveFn,
	SolveResult,
	SolveDiagnostic,
	SolveCallOptions,
	SolveMode
} from './solve-fn.js';
export type { SolveInput } from './solve-input.js';
export { decodeOutcome, finalizeResult } from './outcome.js';
export type { SolveOutcome } from './outcome.js';
export { BINARY_SOLVE_MEDIA_TYPE } from './binary-response.js';
