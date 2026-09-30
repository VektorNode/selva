import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { SolveEndedKind } from '@selvajs/schemas';
import type { SelvaEventTarget } from '@selvajs/compute/grasshopper';
import { decodeOutcome } from '@selvajs/solve/shared';
import { getSolveEventBus } from './bus.server';
import { mintSolveToken } from './token.server';

/**
 * The one owner key for a live stream and the solves bound to it. The SSE route, the cancel route
 * and `runSolve` all derive it here, so they cannot disagree about who owns what. Null for a
 * caller with no user (a share-link viewer): they get no stream yet.
 */
export function liveOwnerKey(userId: string | null | undefined): string | null {
	return userId ? `user:${userId}` : null;
}

export interface LiveSolve {
	/** The callback block for the Compute request; absent when this solve has no live channel. */
	readonly selvaEvents?: SelvaEventTarget;
	/** Publishes `solveEnded` and closes the solve. Safe to call on an unbound solve. */
	end(kind: SolveEndedKind): void;
}

const UNBOUND: LiveSolve = { end() {} };

/**
 * Binds a solve to the caller's stream when they opened one and it is theirs: the server emits
 * `solveStarted` now, and the Compute request carries a callback so the definition can emit
 * mid-solve. Otherwise the solve runs exactly as it would without a live channel.
 */
export function bindLiveSolve(args: {
	ownerKey: string | null;
	streamId: string | null | undefined;
	request: Request;
	/** How long the callback token stays valid; outlive the solve deadline. */
	tokenTtlMs: number;
}): LiveSolve {
	const { ownerKey, streamId, request, tokenTtlMs } = args;
	const bus = getSolveEventBus();
	if (!ownerKey || !streamId || !bus.ownsStream(streamId, ownerKey)) return UNBOUND;

	const solveId = randomUUID();
	bus.openSolve(solveId, streamId, ownerKey);
	bus.publish(solveId, [{ type: 'solveStarted', at: new Date().toISOString(), payload: {} }]);

	const origin = (env.SELVA_EVENT_CALLBACK_ORIGIN || new URL(request.url).origin).replace(
		/\/$/,
		''
	);
	let ended = false;
	return {
		selvaEvents: {
			url: `${origin}/api/v1/solve-events/${solveId}`,
			solveId,
			token: mintSolveToken(solveId, tokenTtlMs)
		},
		end(kind) {
			if (ended) return;
			ended = true;
			bus.publish(solveId, [
				{ type: 'solveEnded', at: new Date().toISOString(), payload: { kind } }
			]);
			bus.closeSolve(solveId);
		}
	};
}

/**
 * How a solve ended, in `solveEnded`'s vocabulary. A completed solve reads the plugin's verdict
 * from the fork's `selva` block; without one it is `ok`, since the markers only say "blocked" and
 * the client decides that from the response itself.
 */
export function solveEndedKind(outcome: {
	kind: string;
	envelope?: { result?: { selva?: { outcome?: unknown } | null } };
}): SolveEndedKind {
	switch (outcome.kind) {
		case 'ok': {
			const verdict = decodeOutcome(outcome.envelope?.result?.selva?.outcome);
			return verdict?.aborted ? 'aborted' : verdict?.blocked ? 'blocked' : 'ok';
		}
		case 'client_abort':
		case 'timeout':
			return 'aborted';
		default:
			return 'error';
	}
}
