// ============================================================================
// client/ — the browser half: input change → solve request
// ============================================================================
//
// The schema-driven value and lifecycle state machine, plus the driver seam that gives it a
// transport. See ./README.md for how to write a driver.
//
// Must never import `../server/*`. Enforced by eslint `no-restricted-imports`.

export { createSolveSession } from './session/solve-session.js';
export type { SolveSession, SolveSessionArgs, SolveSettlement } from './session/solve-session.js';

export { createRequestResponseDriver } from './drivers/request-response.js';
export type { RequestResponseDriverOptions } from './drivers/request-response.js';
export type { SolveDriver, SolveReporter, SolveEventSource } from './drivers/driver.js';

export { createSolveEventStream } from './events/solve-event-stream.js';
export type { SolveEventStream, SolveEventStreamOptions } from './events/solve-event-stream.js';

export { EMPTY_LIVE_SOLVE } from './events/live-solve.js';
export type { LiveSolveState } from './events/live-solve.js';

export type { SolvePhase, RetainedSolveResult } from './session/solve-session-core.js';
export type { DeferredFiles } from './session/deferred-files.js';

export { createComputeFetchSolveFn } from './compute-fetch-solve-fn.js';
export type { ComputeFetchSolveFnOptions } from './compute-fetch-solve-fn.js';

export { stableInputKey } from './solve-memo.js';
export type { MeshPolicy } from './solve-memo.js';

// A pre-step producer route writes a value here and the solver route reads it back.
export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs
} from './external-storage.js';
export type { ExternalValueRef, ExternalInput } from './external-storage.js';

export type {
	SolveFn,
	SolveResult,
	SolveDiagnostic,
	SolveCallOptions,
	SolveMode
} from '../shared/solve-fn.js';
export { decodeOutcome, finalizeResult } from '../shared/outcome.js';
export type { SolveOutcome } from '../shared/outcome.js';
