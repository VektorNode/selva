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

export { createSolveSession } from './solve-session.js';
export type { SolveSession, SolveSessionArgs } from './solve-session.js';

export { createRequestResponseDriver } from './drivers/request-response.js';
export type { RequestResponseDriverOptions } from './drivers/request-response.js';
export type { SolveDriver, SolveReporter } from './drivers/driver.js';

// Exported (not just used internally) because an alternative framework's host shell
// reimplements only state ownership around these transitions, never the decisions themselves.
export {
	buildInitialValues,
	makeInitialFlags,
	applyValueChange,
	pickInputValues,
	applySolveResult
} from './solve-session-core.js';
export type { SolveSessionState, ExternalReader } from './solve-session-core.js';

export { createAsyncThrottle } from './async-throttle.js';
export type { AsyncThrottle } from './async-throttle.js';

export { createSolveMemo, stableInputKey } from './solve-memo.js';
export type { SolveMemo, SolveMemoOptions, MeshPolicy } from './solve-memo.js';

// A pre-step producer route writes a value here and the solver route reads it back —
// `buildInitialValues` hydrates from it.
export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs
} from './external-storage.js';
export type { ExternalValueRef, ExternalInput } from './external-storage.js';

export type { SolveFn, SolveResult } from '../shared/solve-fn.js';
