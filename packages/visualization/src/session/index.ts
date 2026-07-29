// ============================================================================
// session/ — the public barrel
// ============================================================================
//
// Inputs → solve → outputs. The transport-agnostic value and lifecycle state machine,
// plus the driver seam that gives it a transport. Independent of `scene/`, `render/` and
// `parse/`: a session only knows `SolveResult`, which is what lets the same session drive
// a WebSocket (plugin) or a Rhino.Compute HTTP call (cloud), and lets a headless consumer
// solve without ever rendering.
//
// Framework-free. `SolveSession` exposes plain getters and a `subscribe()` seam rather
// than carrying framework reactivity; a Svelte host wraps it (see `useSolveSession` in
// `@selvajs/ui`). See ./README.md for how to write a driver.

// The session itself.
export { createSolveSession } from './solve-session.js';
export type { SolveSession, SolveSessionArgs } from './solve-session.js';

// Drivers: the transport seam.
export { createRequestResponseDriver } from './drivers/request-response.js';
export type { SolveDriver, SolveReporter } from './drivers/driver.js';

// The solve contract.
export type { SolveFn, SolveResult } from './solve-fn.js';

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
export { createComputeThrottle } from './compute-throttle.js';

// The client-side result memo. Public for the same reason as the throttle.
export { createSolveMemo, stableInputKey } from './solve-memo.js';
export type { SolveMemo } from './solve-memo.js';

// Client-sourced input transit storage. A pre-step producer route writes a value here and
// the solver route reads it back — `buildInitialValues` hydrates from it.
export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs
} from './external-storage.js';
export type { ExternalValueRef, ExternalInput } from './external-storage.js';
