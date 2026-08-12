// ============================================================================
// shared/ — the vocabulary both halves speak
// ============================================================================
//
// Depends on nothing else in this package; `client/` and `server/` both depend on it, never on
// each other.

export type { SolveFn, SolveResult } from './solve-fn.js';
export type { SolveInput } from './solve-input.js';
