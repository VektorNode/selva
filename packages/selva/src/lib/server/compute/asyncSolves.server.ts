import { AsyncSolveStore, acceptedResponse } from '@selvajs/solve/server';

// One store per server process. Module state, like the solve-event bus.
let store: AsyncSolveStore | null = null;

export function getAsyncSolves(): AsyncSolveStore {
	store ??= new AsyncSolveStore();
	return store;
}

/** Who may read a detached solve. A caller with no user (a share link) holds it by its id alone. */
export function asyncSolveOwner(locals: App.Locals): string | null {
	return locals.user ? `user:${locals.user.id}` : null;
}

/**
 * Runs `work` detached and answers 202 at once. `work` must resolve to every outcome, errors
 * included, as a response: the request that started it is gone by then.
 */
export function startAsyncSolve(
	locals: App.Locals,
	work: (signal: AbortSignal) => Promise<Response>
): Response {
	const solveId = getAsyncSolves().start(asyncSolveOwner(locals), work);
	return acceptedResponse(solveId, `/api/v1/solves/${solveId}`);
}
