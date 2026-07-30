// ============================================================================
// shared/ — the vocabulary both halves speak
// ============================================================================
//
// The types on the wire between `client/` and `server/`, plus (from Phase 5) the canonical input
// keying they must agree on. Depends on nothing in this package; `client/` and `server/` both
// depend on it, and never on each other.

export type { SolveFn, SolveResult } from './solve-fn.js';
export type { SolveInput } from './solve-input.js';
