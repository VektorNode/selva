/**
 * The HTTP layer over {@link createIdempotencyStore}: how a replayed response
 * is keyed, snapshotted, and identified on the wire.
 *
 * The store itself is generic over `T` and knows nothing about requests. This
 * is the part two hosts must agree on to implement the same `Idempotency-Key`
 * contract, and the part each would otherwise reinvent:
 *
 *   - **The key namespaces by caller.** `Idempotency-Key` is client-chosen, so
 *     two tenants can pick the same string. Without the caller in the key one
 *     would replay the other's result — that is the whole security property
 *     here, and a host that got it wrong would leak across tenants with
 *     nothing failing at build time.
 *   - **The response round-trips through a snapshot.** A `Response` body reads
 *     exactly once, so storing the object itself replays an empty body.
 *   - **A replay says so**, via `Idempotency-Replayed`. A client that cannot
 *     tell a replay from a fresh run cannot tell a successful retry from a
 *     second execution.
 *
 * How long a response stays replayable is *not* here: that trades a client's
 * retry window against serving a stale result after the underlying resource
 * moves, and only the host knows its own deadlines.
 */

/** Header stamped on a replayed response, so a client can distinguish one. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';

/**
 * A response flattened into something storable. Kept instead of the `Response`
 * because a body can only be read once.
 */
export interface StoredResponse {
	status: number;
	headers: [string, string][];
	body: ArrayBuffer;
}

/**
 * Namespace a client-chosen key by its caller.
 *
 * `callerId` should be the narrowest identity available — a token id rather
 * than a user id where the host issues per-token credentials, so two tokens
 * held by one user do not share replays.
 */
export function idempotencyKey(callerId: string, clientKey: string): string {
	return `${callerId} ${clientKey}`;
}

/** Flatten a response so it can be replayed. Consumes the body. */
export async function toStoredResponse(res: Response): Promise<StoredResponse> {
	return {
		status: res.status,
		headers: [...res.headers.entries()],
		body: await res.arrayBuffer()
	};
}

/** Rebuild a live `Response` from a snapshot, marking it when it is a replay. */
export function fromStoredResponse(stored: StoredResponse, replayed: boolean): Response {
	const headers = new Headers(stored.headers);
	if (replayed) headers.set(IDEMPOTENCY_REPLAYED_HEADER, 'true');
	return new Response(stored.body, { status: stored.status, headers });
}
