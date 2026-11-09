import { createHmac } from 'node:crypto';
import { hmacKeys } from '#lib/server/keys.server.js';
import type { SolveAccess } from '#lib/server/compute/solve.server.js';

/**
 * Share links have no caller identity, and a remote URL (no `guid`) is caller-chosen, so varying
 * its query string would mint ids: neither gets one, and both route as if compute had no sessions.
 */
export function solveSessionId(access: SolveAccess, guid: string | null): string | undefined {
	if (access.kind !== 'user' || !access.ctx.userId || !guid) return undefined;
	return computeSessionId(access.ctx.userId, guid);
}

/**
 * The `X-Session-Id` for one user's solves of one definition: the compute fork routes them back
 * to the child holding that user's warm document. Derived rather than stored, so every Selva
 * instance computes the same id with no shared state, and the browser can't mint ids to fill
 * compute's claim cap. Keyed, so a compute operator can't recover the user id from it.
 *
 * Undefined without `SELVA_HMAC_KEY`: a routing hint never fails a solve. Rotating the key moves
 * every session to a new id, so each solves cold once.
 */
export function computeSessionId(userId: string, definitionKey: string): string | undefined {
	const key = hmacKeys().current;
	if (!key) return undefined;
	return createHmac('sha256', key)
		.update(`compute-session\0${userId}\0${definitionKey}`)
		.digest('hex')
		.slice(0, 32);
}
