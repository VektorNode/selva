import { solveEventDelivery, type SolveEvent } from '@selvajs/schemas';

/**
 * Routes live solve events to the browser stream that asked for them, and carries
 * the browser's abort request back to the solve.
 *
 * In-process by design, the same constraint the rate limiter has: a second Selva
 * instance needs sticky sessions or a shared implementation of this interface.
 * Nothing outside this module touches the maps, so swapping the implementation is
 * one file.
 */

export interface SolveEventBus {
	/**
	 * Registers a browser stream. `ownerKey` is the caller's identity (`liveOwnerKey`); a
	 * solve may only attach to a stream with the same owner. The same owner reopening an id
	 * (EventSource reconnects) replaces the writer. Returns the unsubscribe, or null when another
	 * owner holds the id.
	 */
	openStream(
		streamId: string,
		ownerKey: string,
		write: (event: SolveEvent) => void
	): (() => void) | null;
	ownsStream(streamId: string, ownerKey: string): boolean;
	/** Binds a solve to a stream. Events for `solveId` go to that stream until `closeSolve`. */
	openSolve(solveId: string, streamId: string, ownerKey: string): void;
	closeSolve(solveId: string): void;
	isOpen(solveId: string): boolean;
	/**
	 * Delivers events from the solve (or from the server itself). `seq` is
	 * re-stamped here, per solve and monotonic, so server-originated and
	 * plugin-originated events share one sequence. Delivered only to a stream the
	 * solve's owner holds. Returns whether an abort is pending, which is what the
	 * callback reply carries back.
	 */
	publish(
		solveId: string,
		events: ReadonlyArray<Omit<SolveEvent, 'seq' | 'solveId'>>
	): {
		abort: boolean;
	};
	/** Only the stream's owner may abort its solve. Returns false when the solve is unknown or not theirs. */
	requestAbort(solveId: string, ownerKey: string): boolean;
}

interface StreamEntry {
	ownerKey: string;
	write: (event: SolveEvent) => void;
}

interface SolveEntry {
	streamId: string;
	ownerKey: string;
	seq: number;
	abortRequested: boolean;
	/** Sliding one-second window for the per-solve event cap. */
	windowStart: number;
	windowCount: number;
}

/** Past this many events per second on one solve, only `critical` kinds get through. */
const MAX_EVENTS_PER_SECOND = 200;
/** A solve the server never closed (crash mid-request) is forgotten after this. */
const STALE_SOLVE_MS = 10 * 60 * 1000;

export function createSolveEventBus(): SolveEventBus {
	const streams = new Map<string, StreamEntry>();
	const solves = new Map<string, SolveEntry & { openedAt: number }>();

	function sweep() {
		const cutoff = Date.now() - STALE_SOLVE_MS;
		for (const [id, entry] of solves) {
			if (entry.openedAt < cutoff) solves.delete(id);
		}
	}

	return {
		openStream(streamId, ownerKey, write) {
			const held = streams.get(streamId);
			if (held && held.ownerKey !== ownerKey) return null;
			streams.set(streamId, { ownerKey, write });
			return () => {
				if (streams.get(streamId)?.write === write) streams.delete(streamId);
			};
		},

		ownsStream(streamId, ownerKey) {
			return streams.get(streamId)?.ownerKey === ownerKey;
		},

		openSolve(solveId, streamId, ownerKey) {
			sweep();
			solves.set(solveId, {
				streamId,
				ownerKey,
				seq: 0,
				abortRequested: false,
				windowStart: Date.now(),
				windowCount: 0,
				openedAt: Date.now()
			});
		},

		closeSolve(solveId) {
			solves.delete(solveId);
		},

		isOpen(solveId) {
			return solves.has(solveId);
		},

		publish(solveId, events) {
			const solve = solves.get(solveId);
			if (!solve) return { abort: false };
			const candidate = streams.get(solve.streamId);
			// The stream id is the tab's secret, but ownership is checked anyway: a stream
			// reopened under another owner must never receive this solve's events.
			const stream = candidate?.ownerKey === solve.ownerKey ? candidate : undefined;

			const now = Date.now();
			if (now - solve.windowStart >= 1000) {
				solve.windowStart = now;
				solve.windowCount = 0;
			}

			for (const event of events) {
				solve.windowCount++;
				if (
					solve.windowCount > MAX_EVENTS_PER_SECOND &&
					solveEventDelivery(event.type) !== 'critical'
				)
					continue;
				solve.seq++;
				stream?.write({ ...event, solveId, seq: solve.seq });
			}

			return { abort: solve.abortRequested };
		},

		requestAbort(solveId, ownerKey) {
			const solve = solves.get(solveId);
			if (!solve || solve.ownerKey !== ownerKey) return false;
			solve.abortRequested = true;
			return true;
		}
	};
}

// One bus per server process. Module state, like the rate limiter and the caches.
let bus: SolveEventBus | null = null;

export function getSolveEventBus(): SolveEventBus {
	bus ??= createSolveEventBus();
	return bus;
}
