// ============================================================================
// client/ — the browser half: input change → solve request
// ============================================================================
//
// The schema-driven value and lifecycle state machine, plus the driver seam that gives it a
// transport. It knows only `SolveResult` from `shared/` — which is what lets the same
// session drive a WebSocket (the Grasshopper plugin) or an HTTP call (the cloud app), and
// lets a headless consumer solve without ever rendering.
//
// Framework-free and renderer-free. `SolveSession` exposes plain getters and a
// `subscribe()` seam rather than carrying framework reactivity; a Svelte host wraps it (see
// `useSolveSession` in `@selvajs/ui`). Meshes stay opaque — the ownership policy the memo
// needs is injected. See ./README.md for how to write a driver.
//
// Must never import `../server/*`. Enforced by eslint `no-restricted-imports`.

// The session itself.
export { createSolveSession } from './solve-session.js';
export type { SolveSession, SolveSessionArgs } from './solve-session.js';

// Drivers: the transport seam.
export { createRequestResponseDriver } from './drivers/request-response.js';
export type { RequestResponseDriverOptions } from './drivers/request-response.js';
export type { SolveDriver, SolveReporter } from './drivers/driver.js';

// Pure transition logic. Exported because it is the testable core of the state machine and
// an alternative host (a different framework's shell) reimplements only the state
// ownership around it, never these decisions.
export {
	buildInitialValues,
	makeInitialFlags,
	applyValueChange,
	pickInputValues,
	applySolveResult
} from './solve-session-core.js';
export type { SolveSessionState, ExternalReader } from './solve-session-core.js';

// The single-in-flight throttle. Public so a custom driver gets latest-wins abort
// semantics for free instead of re-deriving them.
export { createAsyncThrottle } from './async-throttle.js';
export type { AsyncThrottle } from './async-throttle.js';

// The client-side result memo (M2). Public for the same reason as the throttle.
export { createSolveMemo, stableInputKey } from './solve-memo.js';
export type { SolveMemo, SolveMemoOptions, MeshPolicy } from './solve-memo.js';

// Client-sourced input transit storage. A pre-step producer route writes a value here and
// the solver route reads it back — `buildInitialValues` hydrates from it.
export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs
} from './external-storage.js';
export type { ExternalValueRef, ExternalInput } from './external-storage.js';

// Re-exported from `shared/` so a client consumer gets the solve contract from the barrel it
// already imports. `shared/` remains the declaring home.
export type { SolveFn, SolveResult } from '../shared/solve-fn.js';
