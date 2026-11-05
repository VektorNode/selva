/**
 * This app's instance of the solve idempotency store, and the one policy
 * decision it owns: how long a completed solve stays replayable.
 *
 * The wire contract (caller namespacing, body fingerprint, response snapshot,
 * `Idempotency-Replayed`) lives in `@selvajs/server/api` as `runIdempotent`.
 * What cannot live there is the TTL: it trades a client's retry-on-timeout
 * window against serving a stale result, and only this deployment knows its
 * own solve deadline.
 */

import { createApiIdempotencyStore } from '@selvajs/server/api';

/**
 * Long enough to cover a client's retry-on-timeout (the solve deadline is on
 * the order of a minute), short enough that this never functions as a result
 * cache — a definition's live version can move, and a replay past that window
 * would serve stale geometry.
 */
export const IDEMPOTENCY_TTL_MS = 5 * 60_000;

export const solveIdempotencyStore = createApiIdempotencyStore(IDEMPOTENCY_TTL_MS);

/** Test seam — drops all entries. The store is module-global and tests share one process. */
export function resetIdempotencyStore(): void {
	solveIdempotencyStore.reset();
}

/** Retained entry count. Test/observability seam. */
export function idempotencyStoreSize(): number {
	return solveIdempotencyStore.size();
}
