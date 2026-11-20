// ============================================================================
// Detached solve: wire format
// ============================================================================
//
// A solve that outlives its request, so no proxy timeout on the way can cut it.
//
//   POST <solve endpoint>     Prefer: respond-async
//     → 202, Preference-Applied: respond-async, Location: <poll URL>, body `AsyncSolveAccepted`
//   GET <poll URL>?wait=<s>   long-polls up to ASYNC_POLL_WAIT_S
//     → 202 + `AsyncSolveAccepted` while it runs
//     → otherwise the response the synchronous request would have returned, status included
//     → 404 once the result has expired, was read by someone else's session, or never existed
//   DELETE <poll URL>         cancels it
//
// A server that ignores the preference answers synchronously, and the client reads that as is.

/** RFC 7240's own preference, so a generic proxy or client already knows what it means. */
export const ASYNC_PREFERENCE = 'respond-async';

/** Seconds one poll may wait. Under the 30 s many load balancers allow an idle upstream. */
export const ASYNC_POLL_WAIT_S = 25;

export interface AsyncSolveAccepted {
	solveId: string;
}
