// ============================================================================
// shared/ — the vocabulary both halves speak
// ============================================================================
//
// Depends on nothing else in this package; `client/` and `server/` both depend on it, never on
// each other.

export type { SolveFn, SolveResult, SolveDiagnostic } from './solve-fn.js';
export { SOLVE_BLOCKED_MARKER } from './solve-fn.js';
export type { SolveInput } from './solve-input.js';
